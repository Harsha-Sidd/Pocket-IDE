import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { spawn, exec, execSync } from 'child_process';
import util from 'util';

import dotenv from 'dotenv';
import { runAgentLoop } from './agent.js';
import os from 'os';
import crypto from 'crypto';
import { bin as cfBin } from 'cloudflared';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const WORKSPACE_DIR = path.join(__dirname, 'workspace');

// Ensure workspace directory exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

let activeTunnel = null;
let tunnelUrl = null;
let tunnelPassword = null;
let isAgentRunning = false;

function runGitCommand(args, cwd = WORKSPACE_DIR) {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    
    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        resolve({
          success: false,
          error: `git command failed with exit code ${code}`,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }
    });
    
    gitProcess.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function redactToken(str, token) {
  if (!token || !str) return str;
  return str.split(token).join('<redacted>');
}

// Authentication middleware for secure global access
function authMiddleware(req, res, next) {
  if (!tunnelPassword) {
    return next();
  }
  
  const bypassPaths = [
    '/login.html',
    '/api/auth/login',
    '/style.css'
  ];
  
  if (bypassPaths.includes(req.path) || req.path.startsWith('/assets/')) {
    return next();
  }
  
  let token = req.headers['authorization'];
  if (token && token.startsWith('Bearer ')) {
    token = token.substring(7);
  } else {
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(c => {
      const parts = c.trim().split('=');
      if (parts[0]) {
        cookies[parts[0].trim()] = parts[1] ? parts[1].trim() : '';
      }
    });
    token = cookies['pocket_ide_token'];
  }
  
  const expectedHash = crypto.createHash('sha256').update(tunnelPassword).digest('hex');
  if (token === expectedHash) {
    return next();
  }
  
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Access password required.' });
  }
  
  res.redirect('/login.html');
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// Serve the workspace files as a static directory for previewing with smart defaults
app.use('/workspace-preview', (req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    const hasIndex = fs.existsSync(path.join(WORKSPACE_DIR, 'index.html'));
    if (!hasIndex) {
      try {
        // Find any other html file in the workspace
        const files = fs.readdirSync(WORKSPACE_DIR);
        const htmlFile = files.find(f => f.endsWith('.html'));
        if (htmlFile) {
          return res.redirect(`/workspace-preview/${htmlFile}`);
        }
      } catch (err) {
        console.error('Error scanning workspace:', err);
      }

      // Serve a premium placeholder page if no web files exist
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Preview Workspace</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background-color: #0b0d11;
              color: #9ca3af;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              padding: 20px;
              text-align: center;
            }
            .icon {
              font-size: 3.5rem;
              margin-bottom: 16px;
            }
            h3 {
              color: #f3f4f6;
              margin: 0 0 8px 0;
              font-size: 1.25rem;
            }
            p {
              font-size: 0.9rem;
              margin: 0 0 16px 0;
              max-width: 280px;
              line-height: 1.4;
            }
            .highlight {
              color: #a855f7;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="icon">🌐</div>
          <h3>No Web App Found</h3>
          <p>Create an <span class="highlight">index.html</span> file in your workspace or ask the agent to build one to see the preview here!</p>
        </body>
        </html>
      `);
    }
  }
  express.static(WORKSPACE_DIR)(req, res, next);
});

// Helper: resolve and validate paths to stay within workspace
function resolvePath(safePath) {
  const resolved = path.resolve(WORKSPACE_DIR, safePath);
  const relative = path.relative(WORKSPACE_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Access Denied: Path is outside workspace.');
  }
  return resolved;
}

// REST API for File Explorer
app.get('/api/files', (req, res) => {
  try {
    const listFilesRecursive = (dir, relativePath = '') => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      let result = [];
      for (const item of items) {
        const relPath = path.join(relativePath, item.name).replace(/\\/g, '/');
        const absPath = path.join(dir, item.name);
        
        if (item.name === 'node_modules' || item.name === '.git') continue;

        if (item.isDirectory()) {
          result.push({
            name: item.name,
            path: relPath,
            type: 'directory',
            children: listFilesRecursive(absPath, relPath)
          });
        } else {
          result.push({
            name: item.name,
            path: relPath,
            type: 'file',
            size: fs.statSync(absPath).size
          });
        }
      }
      return result;
    };

    const files = listFilesRecursive(WORKSPACE_DIR);
    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/file-content', (req, res) => {
  try {
    const filePath = resolvePath(req.query.path || '');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    // Limit to 2MB (2 * 1024 * 1024 bytes)
    const MAX_SIZE = 2 * 1024 * 1024;
    if (stat.size > MAX_SIZE) {
      return res.status(400).json({ 
        success: false, 
        error: `File is too large to display (${(stat.size / (1024 * 1024)).toFixed(2)} MB). Maximum supported size is 2.00 MB.` 
      });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, content });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/files/write', (req, res) => {
  try {
    const { path: relPath, content, isBase64 } = req.body;
    if (!relPath) throw new Error('Path is required');
    const filePath = resolvePath(relPath);
    
    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (isBase64) {
      const buffer = Buffer.from(content || '', 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      fs.writeFileSync(filePath, content || '', 'utf-8');
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/files/delete', (req, res) => {
  try {
    const { path: relPath } = req.body;
    if (!relPath) throw new Error('Path is required');
    const filePath = resolvePath(relPath);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = lowerName.includes('virtual') || 
                      lowerName.includes('vbox') || 
                      lowerName.includes('vmware') || 
                      lowerName.includes('host-only') ||
                      lowerName.includes('wsl') ||
                      lowerName.includes('loopback') ||
                      lowerName.includes('npcap');

    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        let priority = 0; // fallback lowest priority
        
        if (isVirtual) {
          priority = 1;
        } else if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
          priority = 4; // Wi-Fi is highest priority for mobile scanning
        } else if (lowerName.includes('ethernet') || lowerName.includes('eth') || lowerName.includes('lan')) {
          // Check for common VirtualBox host-only default subnets
          if (net.address.startsWith('192.168.56.')) {
            priority = 1; // Demote VirtualBox host-only
          } else {
            priority = 3; // Physical Ethernet
          }
        } else {
          priority = 2; // Generic physical adapter
        }
        
        candidates.push({ address: net.address, priority });
      }
    }
  }

  if (candidates.length > 0) {
    // Sort descending by priority
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0].address;
  }

  return 'localhost';
}

app.get('/api/network-info', (req, res) => {
  const ip = getLocalIpAddress();
  const activeUrl = tunnelUrl || `http://${ip}:${PORT}`;
  res.json({
    success: true,
    localIp: ip,
    localUrl: activeUrl,
    qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(activeUrl)}`,
    tunnelActive: !!tunnelUrl
  });
});

function isCommandWorking(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

function getCloudflaredUrl() {
  const platform = process.platform;
  const arch = process.arch;
  
  if (platform === 'win32') {
    if (arch === 'arm64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe';
    if (arch === 'ia32') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe';
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  }
  
  if (platform === 'darwin') {
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64';
  }
  
  if (platform === 'linux') {
    if (arch === 'arm64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
    if (arch === 'arm') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm';
    if (arch === 'ia32') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386';
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
  }
  
  throw new Error(`Unsupported platform: ${platform}`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download Cloudflare Tunnel binary: ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755); // make executable
  }
}

async function ensureCloudflared() {
  // 1. Try global system command 'cloudflared'
  if (isCommandWorking('cloudflared')) {
    return 'cloudflared';
  }
  
  // 2. Try NPM module bin path
  const npmBin = cfBin;
  if (fs.existsSync(npmBin) && isCommandWorking(`"${npmBin}"`)) {
    return npmBin;
  }
  
  // 3. Try local project root binary
  const localBinName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const localPath = path.join(__dirname, localBinName);
  if (fs.existsSync(localPath) && isCommandWorking(`"${localPath}"`)) {
    return localPath;
  }
  
  // 4. Download it dynamically to project root if missing or broken!
  console.log('[Cloudflared] Binary not found or working. Downloading latest release for your platform...');
  const downloadUrl = getCloudflaredUrl();
  console.log(`[Cloudflared] Downloading from: ${downloadUrl}`);
  
  await downloadFile(downloadUrl, localPath);
  
  if (isCommandWorking(`"${localPath}"`)) {
    console.log(`[Cloudflared] Successfully downloaded and verified local binary at: ${localPath}`);
    return localPath;
  }
  
  throw new Error('Downloaded Cloudflare Tunnel binary failed verification. Please install cloudflared manually on your system.');
}

app.post('/api/tunnel/toggle', async (req, res) => {
  const { enabled, password } = req.body;
  
  if (enabled) {
    if (!password) {
      return res.status(400).json({ success: false, error: 'Access password is required to enable global tunnel.' });
    }
    try {
      if (activeTunnel) {
        console.log('[Cloudflared] Stopping existing tunnel process...');
        activeTunnel.kill();
        activeTunnel = null;
        tunnelUrl = null;
      }
      
      tunnelPassword = password;
      
      const cfPath = await ensureCloudflared();
      
      console.log('[Cloudflared] Starting secure quick tunnel using binary:', cfPath);
      activeTunnel = spawn(cfPath, ['tunnel', '--url', `http://localhost:${PORT}`]);
      
      let resolved = false;
      
      activeTunnel.stderr.on('data', (data) => {
        const line = data.toString();
        // Log inside node server console
        console.log(`[Cloudflared Log] ${line.trim()}`);
        
        if (line.includes('.trycloudflare.com') && !resolved) {
          const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (match) {
            resolved = true;
            tunnelUrl = match[0];
            console.log(`[Cloudflared] Secure tunnel is active at: ${tunnelUrl}`);
            res.json({ success: true, url: tunnelUrl });
          }
        }
      });
      
      activeTunnel.on('close', (code) => {
        console.log(`[Cloudflared] Tunnel process closed with exit code ${code}`);
        activeTunnel = null;
        tunnelUrl = null;
        tunnelPassword = null;
      });
      
      // Safety timeout: if tunnel doesn't resolve in 15 seconds, exit and return error
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (activeTunnel) {
            activeTunnel.kill();
            activeTunnel = null;
          }
          tunnelPassword = null;
          res.status(500).json({ success: false, error: 'Cloudflare Tunnel failed to resolve public URL. Please check connection and try again.' });
        }
      }, 15000);
      
    } catch (err) {
      tunnelPassword = null;
      activeTunnel = null;
      tunnelUrl = null;
      res.status(500).json({ success: false, error: err.message });
    }
  } else {
    try {
      if (activeTunnel) {
        console.log('[Cloudflared] Disabling tunnel...');
        activeTunnel.kill();
        activeTunnel = null;
        tunnelUrl = null;
        tunnelPassword = null;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!tunnelPassword) {
    return res.json({ success: true, message: 'No access password set.' });
  }
  if (password === tunnelPassword) {
    const expectedHash = crypto.createHash('sha256').update(tunnelPassword).digest('hex');
    res.json({ success: true, token: expectedHash });
  } else {
    res.status(401).json({ success: false, error: 'Invalid access password' });
  }
});

// Git Integration REST APIs
app.get('/api/git/status', async (req, res) => {
  const isRepo = fs.existsSync(path.join(WORKSPACE_DIR, '.git'));
  if (!isRepo) {
    return res.json({ success: true, isRepo: false });
  }
  try {
    const branchRes = await runGitCommand(['branch', '--show-current']);
    const branch = branchRes.success ? branchRes.stdout : 'unknown';
    const statusRes = await runGitCommand(['status', '--porcelain']);
    let files = [];
    if (statusRes.success && statusRes.stdout) {
      files = statusRes.stdout.split('\n').map(line => {
        const type = line.substring(0, 2).trim();
        const filepath = line.substring(3).trim();
        return { type, path: filepath };
      });
    }
    res.json({ success: true, isRepo: true, branch, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/git/clone', async (req, res) => {
  const { repoUrl, token } = req.body;
  if (!repoUrl) {
    return res.status(400).json({ success: false, error: 'Repository URL is required' });
  }
  let targetUrl = repoUrl;
  if (token) {
    if (repoUrl.startsWith('https://github.com/')) {
      targetUrl = repoUrl.replace('https://', `https://${token}@`);
    }
  }
  try {
    const items = fs.readdirSync(WORKSPACE_DIR);
    for (const item of items) {
      const absPath = path.join(WORKSPACE_DIR, item);
      fs.rmSync(absPath, { recursive: true, force: true });
    }
    const cloneRes = await runGitCommand(['clone', targetUrl, '.']);
    if (!cloneRes.success) {
      const sanitizedError = redactToken(cloneRes.stderr || cloneRes.error, token);
      return res.status(500).json({ success: false, error: sanitizedError });
    }
    res.json({ success: true });
  } catch (err) {
    const sanitizedError = redactToken(err.message, token);
    res.status(500).json({ success: false, error: sanitizedError });
  }
});

app.post('/api/git/sync', async (req, res) => {
  const { action, commitMessage, userName, userEmail } = req.body;
  if (action === 'pull') {
    const pullRes = await runGitCommand(['pull']);
    if (!pullRes.success) {
      return res.status(500).json({ success: false, error: pullRes.stderr || pullRes.error });
    }
    return res.json({ success: true, stdout: pullRes.stdout });
  }
  if (action === 'commit') {
    if (!commitMessage) {
      return res.status(400).json({ success: false, error: 'Commit message is required' });
    }
    try {
      if (userName) await runGitCommand(['config', 'user.name', userName]);
      else await runGitCommand(['config', 'user.name', 'Pocket IDE User']);
      if (userEmail) await runGitCommand(['config', 'user.email', userEmail]);
      else await runGitCommand(['config', 'user.email', 'pocket-ide@local.dev']);

      await runGitCommand(['add', '-A']);
      const commitRes = await runGitCommand(['commit', '-m', commitMessage]);
      if (!commitRes.success) {
        return res.status(500).json({ success: false, error: commitRes.stderr || commitRes.error });
      }
      const pushRes = await runGitCommand(['push']);
      if (!pushRes.success) {
        return res.status(500).json({ success: false, error: pushRes.stderr || pushRes.error });
      }
      res.json({ success: true, stdout: pushRes.stdout });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

app.post('/api/git/disconnect', (req, res) => {
  try {
    const gitDir = path.join(WORKSPACE_DIR, '.git');
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// REST API for AI Agent
app.post('/api/agent/chat', async (req, res) => {
  const { message, history, apiKey, model, provider } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'API Key is required' });
  }

  if (isAgentRunning) {
    return res.status(429).json({ success: false, error: 'Another AI Agent request is currently running. Please wait.' });
  }
  isAgentRunning = true;

  // Setup streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAgentLoop(message, history, apiKey, WORKSPACE_DIR, model, provider, (update) => {
      sendEvent('agent-update', update);
    });
    sendEvent('complete', { done: true });
    res.end();
  } catch (error) {
    sendEvent('error', { error: error.message });
    res.end();
  } finally {
    isAgentRunning = false;
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// WebSockets for Terminal Integration
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const isTerminal = url.pathname === '/ws/terminal';

  if (!isTerminal) {
    ws.close();
    return;
  }

  // Verify token if tunnelPassword is enabled
  if (tunnelPassword) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(c => {
      const parts = c.trim().split('=');
      if (parts[0]) {
        cookies[parts[0].trim()] = parts[1] ? parts[1].trim() : '';
      }
    });
    const expectedHash = crypto.createHash('sha256').update(tunnelPassword).digest('hex');
    if (cookies['pocket_ide_token'] !== expectedHash) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }

  // Spawn terminal shell
  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : 'bash';
  
  // Set up shell execution in workspace directory
  const shellProcess = spawn(shell, [], {
    cwd: WORKSPACE_DIR,
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  shellProcess.stdout.on('data', (data) => {
    ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
  });

  shellProcess.stderr.on('data', (data) => {
    ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
  });

  shellProcess.on('close', (code) => {
    ws.send(JSON.stringify({ type: 'exit', data: `\r\nProcess exited with code ${code}\r\n` }));
    ws.close();
  });

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'input') {
        shellProcess.stdin.write(parsed.data);
      }
    } catch (e) {
      // Raw string input fallback
      shellProcess.stdin.write(message.toString());
    }
  });

  ws.on('close', () => {
    shellProcess.kill();
  });
});

server.listen(PORT, () => {
  console.log(`Pocket IDE is running on http://localhost:${PORT}`);
});
