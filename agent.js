import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const listFilesTool = (workspaceDir) => {
  const listRecursive = (dir) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    let files = [];
    for (const item of items) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(workspaceDir, fullPath).replace(/\\/g, '/');
      if (item.isDirectory()) {
        files.push({ path: relPath, type: 'directory' });
        files = files.concat(listRecursive(fullPath));
      } else {
        files.push({ path: relPath, type: 'file' });
      }
    }
    return files;
  };
  return { files: listRecursive(workspaceDir) };
};

const readFileTool = (workspaceDir, relPath) => {
  const filePath = path.resolve(workspaceDir, relPath);
  const relative = path.relative(workspaceDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { error: 'Access denied: Path is outside workspace.' };
  }
  if (!fs.existsSync(filePath)) {
    return { error: `File not found: ${relPath}` };
  }
  return { content: fs.readFileSync(filePath, 'utf-8') };
};

const writeFileTool = (workspaceDir, relPath, content) => {
  const filePath = path.resolve(workspaceDir, relPath);
  const relative = path.relative(workspaceDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { error: 'Access denied: Path is outside workspace.' };
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content || '', 'utf-8');
  return { success: true };
};

const runCommandTool = (workspaceDir, command) => {
  return new Promise((resolve) => {
    exec(command, { cwd: workspaceDir, timeout: 45000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: error ? error.code : 0
      });
    });
  });
};

const executeTool = async (name, args, workspaceDir) => {
  if (name === 'list_files') {
    return listFilesTool(workspaceDir);
  } else if (name === 'read_file') {
    return readFileTool(workspaceDir, args.path);
  } else if (name === 'write_file') {
    return writeFileTool(workspaceDir, args.path, args.content);
  } else if (name === 'run_command') {
    return await runCommandTool(workspaceDir, args.command);
  } else {
    return { error: `Tool ${name} not found` };
  }
};

// 1. OpenAI Integration
async function callOpenAI(messages, apiKey, modelName, toolsDefinition) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName || 'gpt-4o-mini',
      messages,
      tools: toolsDefinition,
      tool_choice: 'auto'
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
  }
  
  return await response.json();
}

async function runOpenAILoop(message, history, apiKey, workspaceDir, modelName, callback) {
  const systemInstruction = `You are Pocket Agent, an autonomous full-stack software engineering agent working inside a Web IDE.
You have access to a workspace directory and can view/write files and execute command lines.
Your goal is to satisfy the user's coding requests efficiently.
When editing files or creating code, ensure you write clean, robust code.
Always explain what you are doing (e.g. "I am going to write index.html now...").
Keep descriptions concise so the user gets clear updates.`;

  const messages = [{ role: 'system', content: systemInstruction }];
  
  if (history && history.length > 0) {
    for (const h of history) {
      const role = h.role === 'model' ? 'assistant' : 'user';
      const text = h.parts && h.parts[0] ? h.parts[0].text : '';
      if (text) {
        messages.push({ role, content: text });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  const toolsDefinition = [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'Lists all files recursively in the workspace.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Reads the content of a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to read' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Writes or updates the content of a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to write' },
            content: { type: 'string', description: 'Complete content of the file' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Runs a shell command in the workspace directory and returns its output.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to run, e.g. "npm install" or "ls"' }
          },
          required: ['command']
        }
      }
    }
  ];

  callback({ status: 'started', message: 'Agent (OpenAI) initialized. Starting execution...' });

  let keepGoing = true;
  let finalResultText = '';
  
  while (keepGoing) {
    const res = await callOpenAI(messages, apiKey, modelName, toolsDefinition);
    const choice = res.choices[0];
    const messageObj = choice.message;
    
    messages.push(messageObj);
    
    if (messageObj.tool_calls && messageObj.tool_calls.length > 0) {
      const toolCalls = messageObj.tool_calls;
      for (const call of toolCalls) {
        const name = call.function.name;
        const args = JSON.parse(call.function.arguments);
        
        callback({ status: 'tool_start', tool: name, args });
        const result = await executeTool(name, args, workspaceDir);
        callback({ status: 'tool_end', tool: name, result });
        
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: name,
          content: JSON.stringify(result)
        });
      }
    } else {
      finalResultText = messageObj.content || '';
      keepGoing = false;
    }
  }

  callback({ status: 'completed', text: finalResultText });
}

// 2. Anthropic Integration
async function callAnthropic(messages, apiKey, modelName, toolsDefinition, systemInstruction) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelName || 'claude-3-5-sonnet-latest',
      max_tokens: 4096,
      system: systemInstruction,
      messages,
      tools: toolsDefinition
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
  }
  
  return await response.json();
}

async function runAnthropicLoop(message, history, apiKey, workspaceDir, modelName, callback) {
  const systemInstruction = `You are Pocket Agent, an autonomous full-stack software engineering agent working inside a Web IDE.
You have access to a workspace directory and can view/write files and execute command lines.
Your goal is to satisfy the user's coding requests efficiently.
When editing files or creating code, ensure you write clean, robust code.
Always explain what you are doing (e.g. "I am going to write index.html now...").
Keep descriptions concise so the user gets clear updates.`;

  const messages = [];
  
  if (history && history.length > 0) {
    for (const h of history) {
      const role = h.role === 'model' ? 'assistant' : 'user';
      const text = h.parts && h.parts[0] ? h.parts[0].text : '';
      if (text) {
        messages.push({ role, content: text });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  const toolsDefinition = [
    {
      name: 'list_files',
      description: 'Lists all files recursively in the workspace.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'read_file',
      description: 'Reads the content of a file in the workspace.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to read' }
        },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: 'Writes or updates the content of a file in the workspace.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to write' },
          content: { type: 'string', description: 'Complete content of the file' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'run_command',
      description: 'Runs a shell command in the workspace directory and returns its output.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run, e.g. "npm install" or "ls"' }
        },
        required: ['command']
      }
    }
  ];

  callback({ status: 'started', message: 'Agent (Anthropic) initialized. Starting execution...' });

  let keepGoing = true;
  let finalResultText = '';
  
  while (keepGoing) {
    const res = await callAnthropic(messages, apiKey, modelName, toolsDefinition, systemInstruction);
    const content = res.content;
    
    messages.push({ role: 'assistant', content });
    
    const toolUseBlocks = content.filter(block => block.type === 'tool_use');
    
    if (toolUseBlocks.length > 0) {
      const toolResults = [];
      for (const block of toolUseBlocks) {
        const name = block.name;
        const args = block.input;
        
        callback({ status: 'tool_start', tool: name, args });
        const result = await executeTool(name, args, workspaceDir);
        callback({ status: 'tool_end', tool: name, result });
        
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      const textBlock = content.find(block => block.type === 'text');
      finalResultText = textBlock ? textBlock.text : '';
      keepGoing = false;
    }
  }

  callback({ status: 'completed', text: finalResultText });
}

// 3. Gemini SDK Implementation
async function runGeminiLoop(message, history, apiKey, workspaceDir, modelName, callback) {
  const genAI = new GoogleGenerativeAI(apiKey);
  
  const tools = [{
    functionDeclarations: [
      {
        name: 'list_files',
        description: 'Lists all files recursively in the workspace.',
        parameters: { type: 'OBJECT', properties: {}, required: [] }
      },
      {
        name: 'read_file',
        description: 'Reads the content of a file in the workspace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Relative path of the file to read' }
          },
          required: ['path']
        }
      },
      {
        name: 'write_file',
        description: 'Writes or updates the content of a file in the workspace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Relative path of the file to write' },
            content: { type: 'STRING', description: 'Complete content of the file' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'run_command',
        description: 'Runs a shell command in the workspace directory and returns its output.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: { type: 'STRING', description: 'The shell command to run, e.g. "npm install" or "ls"' }
          },
          required: ['command']
        }
      }
    ]
  }];

  const model = genAI.getGenerativeModel({
    model: modelName || 'gemini-1.5-flash',
    tools: tools
  });

  const systemInstruction = `You are Pocket Agent, an autonomous full-stack software engineering agent working inside a Web IDE.
You have access to a workspace directory and can view/write files and execute command lines.
Your goal is to satisfy the user's coding requests efficiently.
When editing files or creating code, ensure you write clean, robust code.
Always explain what you are doing (e.g. "I am going to write index.html now...").
Keep descriptions concise so the user gets clear updates.`;

  const chat = model.startChat({
    history: history || [],
    systemInstruction: systemInstruction
  });

  callback({ status: 'started', message: 'Agent (Gemini) initialized. Starting execution...' });

  let response = await chat.sendMessage(message);

  while (response.functionCalls && response.functionCalls.length > 0) {
    const functionCalls = response.functionCalls;
    const parts = [];

    for (const call of functionCalls) {
      const { name, args } = call;
      callback({ status: 'tool_start', tool: name, args });
      
      const result = await executeTool(name, args, workspaceDir);
      
      callback({ status: 'tool_end', tool: name, result });
      parts.push({
        functionResponse: {
          name: name,
          response: result
        }
      });
    }

    response = await chat.sendMessage(parts);
  }

  callback({ status: 'completed', text: response.text });
}

export async function runAgentLoop(message, history, apiKey, workspaceDir, modelName, provider, callback) {
  if (provider === 'openai') {
    return await runOpenAILoop(message, history, apiKey, workspaceDir, modelName, callback);
  } else if (provider === 'anthropic') {
    return await runAnthropicLoop(message, history, apiKey, workspaceDir, modelName, callback);
  } else {
    // Default to Gemini
    return await runGeminiLoop(message, history, apiKey, workspaceDir, modelName, callback);
  }
}
