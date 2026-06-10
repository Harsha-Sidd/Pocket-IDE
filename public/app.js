// Intercept all API calls and check for 401 Unauthorized
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch(...args);
    if (response.status === 401 && !args[0].endsWith('/api/auth/login')) {
      window.location.href = '/login.html';
    }
    return response;
  };
})();

// State Management
const state = {
  provider: localStorage.getItem('pocket_ide_provider') || 'gemini',
  apiKeyGemini: localStorage.getItem('pocket_ide_gemini_key') || '',
  apiKeyOpenai: localStorage.getItem('pocket_ide_openai_key') || '',
  apiKeyAnthropic: localStorage.getItem('pocket_ide_anthropic_key') || '',
  model: localStorage.getItem('pocket_ide_model') || '',
  fontSize: parseInt(localStorage.getItem('pocket_ide_font_size')) || 14,
  theme: localStorage.getItem('pocket_ide_theme') || 'theme-midnight',
  currentFilePath: '',
  files: [],
  expandedFolders: new Set(),
  chatHistory: [],
  tunnelActive: false,
  tunnelPassword: '',
  pendingUserMessage: ''
};

// DOM Elements
const elements = {
  btnSettings: document.getElementById('btn-settings'),
  settingsModal: document.getElementById('settings-modal'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  inputApiKey: document.getElementById('input-api-key'),
  apiStatusIndicator: document.getElementById('api-status-indicator'),
  btnHeaderPreview: document.getElementById('btn-header-preview'),
  
  // Settings Options
  selectProvider: document.getElementById('select-provider'),
  labelApiKey: document.getElementById('label-api-key'),
  helpApiKey: document.getElementById('help-api-key'),
  selectModel: document.getElementById('select-model'),
  selectTheme: document.getElementById('select-theme'),
  inputFontSize: document.getElementById('input-font-size'),
  valFontSize: document.getElementById('val-font-size'),
  checkGlobalAccess: document.getElementById('check-global-access'),
  groupTunnelPassword: document.getElementById('group-tunnel-password'),
  inputTunnelPassword: document.getElementById('input-tunnel-password'),
  qrCodeImg: document.getElementById('qr-code-img'),
  inputRemoteUrl: document.getElementById('input-remote-url'),
  btnCopyUrl: document.getElementById('btn-copy-url'),
  
  // File Explorer
  fileExplorerTree: document.getElementById('file-explorer-tree'),
  btnNewFile: document.getElementById('btn-new-file'),
  btnNewFolder: document.getElementById('btn-new-folder'),
  btnRefreshFiles: document.getElementById('btn-refresh-files'),
  btnUploadMenu: document.getElementById('btn-upload-menu'),
  uploadDropdown: document.getElementById('upload-dropdown'),
  optUploadFiles: document.getElementById('opt-upload-files'),
  optUploadFolder: document.getElementById('opt-upload-folder'),
  inputUploadFiles: document.getElementById('input-upload-files'),
  inputUploadFolder: document.getElementById('input-upload-folder'),
  
  // Editor
  activeFilename: document.getElementById('active-filename'),
  btnSaveFile: document.getElementById('btn-save-file'),
  editorGutter: document.getElementById('editor-gutter'),
  editorTextarea: document.getElementById('editor-textarea'),
  
  // Chat Agent
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  btnSendChat: document.getElementById('btn-send-chat'),
  btnClearChat: document.getElementById('btn-clear-chat'),
  agentStatusBanner: document.getElementById('agent-status-banner'),
  agentStatusText: document.getElementById('agent-status-text'),
  
  // Terminal
  terminalOutput: document.getElementById('terminal-output'),
  terminalInput: document.getElementById('terminal-input'),
  btnClearTerminal: document.getElementById('btn-clear-terminal'),
  
  // Image Viewer
  panelImageViewer: document.getElementById('panel-image-viewer'),
  imageViewerTitle: document.getElementById('image-viewer-title'),
  imageViewerImg: document.getElementById('image-viewer-img'),
  btnCloseImage: document.getElementById('btn-close-image'),
  
  // Git / Version Control
  panelGit: document.getElementById('panel-git'),
  gitEmptyState: document.getElementById('git-empty-state'),
  gitActiveState: document.getElementById('git-active-state'),
  inputGitUrl: document.getElementById('input-git-url'),
  inputGitToken: document.getElementById('input-git-token'),
  btnGitClone: document.getElementById('btn-git-clone'),
  gitBranchName: document.getElementById('git-branch-name'),
  btnGitPull: document.getElementById('btn-git-pull'),
  gitChangesCount: document.getElementById('git-changes-count'),
  gitChangesList: document.getElementById('git-changes-list'),
  inputGitCommitMsg: document.getElementById('input-git-commit-msg'),
  btnGitCommitPush: document.getElementById('btn-git-commit-push'),
  btnRefreshGit: document.getElementById('btn-refresh-git'),
  btnGitDisconnect: document.getElementById('btn-git-disconnect'),
  
  // Mobile Navigation
  navItems: document.querySelectorAll('.nav-item'),
  panelSections: document.querySelectorAll('.panel-section')
};

// Initialize App
function init() {
  updateApiStatus();
  loadSettings();
  setupEventListeners();
  loadFiles();
  initTerminalWebSocket();
  fetchNetworkInfo();
  loadGitStatus();
  initSidebarResizer();
  initEditorResizer();
}

// 1. Settings & API Key
function updateApiStatus() {
  const dot = elements.apiStatusIndicator.querySelector('.status-dot');
  const label = elements.apiStatusIndicator.querySelector('.status-label');
  
  let activeKey = '';
  if (state.provider === 'gemini') activeKey = state.apiKeyGemini;
  else if (state.provider === 'openai') activeKey = state.apiKeyOpenai;
  else if (state.provider === 'anthropic') activeKey = state.apiKeyAnthropic;
  
  if (activeKey) {
    dot.className = 'status-dot green';
    label.textContent = `${state.provider.toUpperCase()} Active`;
  } else {
    dot.className = 'status-dot red';
    label.textContent = 'No Key';
  }
}

function loadSettings() {
  elements.selectProvider.value = state.provider;
  updateProviderInputs();
  
  elements.selectTheme.value = state.theme;
  applyTheme(state.theme);
  
  elements.inputFontSize.value = state.fontSize;
  elements.valFontSize.textContent = state.fontSize + 'px';
  applyFontSize(state.fontSize);
  
  state.tunnelActive = localStorage.getItem('pocket_ide_tunnel_active') === 'true';
  state.tunnelPassword = localStorage.getItem('pocket_ide_tunnel_password') || '';
  
  elements.checkGlobalAccess.checked = state.tunnelActive;
  elements.groupTunnelPassword.style.display = state.tunnelActive ? 'flex' : 'none';
  elements.inputTunnelPassword.value = state.tunnelPassword;
}

function updateProviderInputs() {
  const provider = elements.selectProvider.value;
  
  if (provider === 'gemini') {
    elements.labelApiKey.textContent = 'Gemini API Key';
    elements.inputApiKey.placeholder = 'Enter Gemini API Key (saved locally)';
    elements.helpApiKey.textContent = 'Enter your Google Gemini API key to enable the AI Coding Agent. The key is stored locally in your browser\'s LocalStorage.';
    elements.inputApiKey.value = state.apiKeyGemini;
  } else if (provider === 'openai') {
    elements.labelApiKey.textContent = 'OpenAI API Key';
    elements.inputApiKey.placeholder = 'Enter OpenAI API Key (saved locally)';
    elements.helpApiKey.textContent = 'Enter your OpenAI API key to enable the AI Coding Agent. The key is stored locally in your browser\'s LocalStorage.';
    elements.inputApiKey.value = state.apiKeyOpenai;
  } else if (provider === 'anthropic') {
    elements.labelApiKey.textContent = 'Anthropic API Key';
    elements.inputApiKey.placeholder = 'Enter Anthropic API Key (saved locally)';
    elements.helpApiKey.textContent = 'Enter your Anthropic API key to enable the AI Coding Agent. The key is stored locally in your browser\'s LocalStorage.';
    elements.inputApiKey.value = state.apiKeyAnthropic;
  }
  
  elements.selectModel.innerHTML = '';
  let models = [];
  if (provider === 'gemini') {
    models = [
      { value: 'gemini-1.5-flash', text: 'Gemini 1.5 Flash (Fast, default)' },
      { value: 'gemini-1.5-pro', text: 'Gemini 1.5 Pro (Powerful, reasoning)' }
    ];
  } else if (provider === 'openai') {
    models = [
      { value: 'gpt-4o-mini', text: 'GPT-4o Mini (Fast, default)' },
      { value: 'gpt-4o', text: 'GPT-4o (Powerful, reasoning)' }
    ];
  } else if (provider === 'anthropic') {
    models = [
      { value: 'claude-3-5-sonnet-latest', text: 'Claude 3.5 Sonnet (Powerful, default)' },
      { value: 'claude-3-haiku-latest', text: 'Claude 3.5 Haiku (Fast)' }
    ];
  }
  
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.text;
    elements.selectModel.appendChild(opt);
  });
  
  const storedModel = localStorage.getItem('pocket_ide_model');
  const hasStoredModel = models.some(m => m.value === storedModel);
  if (hasStoredModel) {
    elements.selectModel.value = storedModel;
  } else {
    elements.selectModel.value = models[0].value;
  }
}

function applyTheme(themeName) {
  document.body.classList.remove('theme-midnight', 'theme-cyberpunk', 'theme-light');
  document.body.classList.add(themeName);
}

function applyFontSize(size) {
  elements.editorTextarea.style.fontSize = size + 'px';
  elements.editorGutter.style.fontSize = size + 'px';
}

async function fetchNetworkInfo() {
  try {
    const response = await fetch('/api/network-info');
    const data = await response.json();
    if (data.success) {
      elements.qrCodeImg.src = data.qrCodeUrl;
      elements.inputRemoteUrl.value = data.localUrl;
      state.tunnelActive = data.tunnelActive;
      elements.checkGlobalAccess.checked = data.tunnelActive;
      elements.groupTunnelPassword.style.display = data.tunnelActive ? 'flex' : 'none';
    } else {
      elements.inputRemoteUrl.value = 'Failed to load remote connection URL';
    }
  } catch (error) {
    console.error('Error fetching network info:', error);
    elements.inputRemoteUrl.value = 'Network info offline';
  }
}

// 2. Event Listeners Setup
function setupEventListeners() {
  elements.btnSettings.addEventListener('click', () => {
    loadSettings();
    elements.settingsModal.classList.add('active');
  });
  
  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsModal.classList.remove('active');
    loadSettings(); // Revert unsaved live preview changes
  });
  
  elements.selectProvider.addEventListener('change', () => {
    updateProviderInputs();
  });
  
  elements.checkGlobalAccess.addEventListener('change', (e) => {
    elements.groupTunnelPassword.style.display = e.target.checked ? 'flex' : 'none';
  });
  
  elements.btnSaveSettings.addEventListener('click', async () => {
    const provider = elements.selectProvider.value;
    state.provider = provider;
    localStorage.setItem('pocket_ide_provider', provider);
    
    const key = elements.inputApiKey.value.trim();
    if (provider === 'gemini') {
      state.apiKeyGemini = key;
      localStorage.setItem('pocket_ide_gemini_key', key);
    } else if (provider === 'openai') {
      state.apiKeyOpenai = key;
      localStorage.setItem('pocket_ide_openai_key', key);
    } else if (provider === 'anthropic') {
      state.apiKeyAnthropic = key;
      localStorage.setItem('pocket_ide_anthropic_key', key);
    }
    
    const model = elements.selectModel.value;
    state.model = model;
    localStorage.setItem('pocket_ide_model', model);
    
    const theme = elements.selectTheme.value;
    state.theme = theme;
    localStorage.setItem('pocket_ide_theme', theme);
    
    const fontSize = parseInt(elements.inputFontSize.value);
    state.fontSize = fontSize;
    localStorage.setItem('pocket_ide_font_size', fontSize);

    // Tunnel toggling API trigger
    const enableTunnel = elements.checkGlobalAccess.checked;
    const tunnelPass = elements.inputTunnelPassword.value.trim();
    
    if (enableTunnel && !tunnelPass) {
      alert('Access password is required when global tunnel access is enabled.');
      return;
    }
    
    const origSaveText = elements.btnSaveSettings.innerHTML;
    elements.btnSaveSettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Settings...';
    elements.btnSaveSettings.disabled = true;
    
    try {
      const response = await fetch('/api/tunnel/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enableTunnel, password: tunnelPass })
      });
      const data = await response.json();
      if (data.success) {
        state.tunnelActive = enableTunnel;
        state.tunnelPassword = tunnelPass;
        localStorage.setItem('pocket_ide_tunnel_active', enableTunnel ? 'true' : 'false');
        localStorage.setItem('pocket_ide_tunnel_password', tunnelPass);
        
        if (enableTunnel) {
          addSystemMessage(`🌐 <strong>Global Access Enabled!</strong> Secure tunnel opened at: <a href="${data.url}" target="_blank">${data.url}</a>. Scan the QR code on your mobile device to connect.`);
        } else {
          addSystemMessage('🌐 Global Access tunnel disabled.');
        }
      } else {
        alert('Failed to configure remote tunnel: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Error toggling tunnel connection.');
    } finally {
      elements.btnSaveSettings.innerHTML = origSaveText;
      elements.btnSaveSettings.disabled = false;
    }

    updateApiStatus();
    await fetchNetworkInfo();
    elements.settingsModal.classList.remove('active');
    addSystemMessage('Settings saved and applied successfully.');
  });

  // Slider change triggers live font resizing
  elements.inputFontSize.addEventListener('input', (e) => {
    const size = e.target.value;
    elements.valFontSize.textContent = size + 'px';
    applyFontSize(size);
  });

  // Theme change triggers live theme preview
  elements.selectTheme.addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  // Copy remote URL to clipboard
  elements.btnCopyUrl.addEventListener('click', () => {
    const url = elements.inputRemoteUrl.value;
    navigator.clipboard.writeText(url).then(() => {
      const origHTML = elements.btnCopyUrl.innerHTML;
      elements.btnCopyUrl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: hsl(var(--success))"></i>';
      setTimeout(() => {
        elements.btnCopyUrl.innerHTML = origHTML;
      }, 1500);
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
    });
  });

  // Header Preview New Tab Action
  elements.btnHeaderPreview.addEventListener('click', () => {
    window.open('/workspace-preview/index.html', '_blank');
  });

  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      
      // Update nav active state
      elements.navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      // Update panels active state
      elements.panelSections.forEach(panel => {
        if (panel.id === targetId) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });

      // Quick layout adjustments on panel switch
      if (targetId === 'panel-editor') {
        elements.editorTextarea.focus();
      } else if (targetId === 'panel-terminal') {
        elements.terminalInput.focus();
      }
    });
  });

  // Editor Save
  elements.btnSaveFile.addEventListener('click', saveCurrentFile);
  
  // Editor text adjustments & line numbering
  elements.editorTextarea.addEventListener('input', updateEditorGutter);
  elements.editorTextarea.addEventListener('scroll', () => {
    elements.editorGutter.scrollTop = elements.editorTextarea.scrollTop;
  });

  // File explorer actions
  elements.btnRefreshFiles.addEventListener('click', loadFiles);
  elements.btnNewFile.addEventListener('click', createNewFilePrompt);
  elements.btnNewFolder.addEventListener('click', createNewFolderPrompt);

  // Upload Actions
  elements.btnUploadMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.uploadDropdown.classList.toggle('active');
  });

  document.addEventListener('click', () => {
    elements.uploadDropdown.classList.remove('active');
  });

  elements.optUploadFiles.addEventListener('click', () => {
    elements.inputUploadFiles.click();
  });

  elements.optUploadFolder.addEventListener('click', () => {
    elements.inputUploadFolder.click();
  });

  elements.inputUploadFiles.addEventListener('change', (e) => {
    handleUpload(e.target.files);
  });

  elements.inputUploadFolder.addEventListener('change', (e) => {
    handleUpload(e.target.files);
  });

  // Close Image Viewer
  elements.btnCloseImage.addEventListener('click', () => {
    elements.panelImageViewer.classList.remove('active');
    if (window.innerWidth <= 1024) {
      document.querySelector('[data-target="panel-files"]').click();
    }
  });

  // Chat Agent
  elements.btnSendChat.addEventListener('click', sendMessageToAgent);
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessageToAgent();
  });
  elements.btnClearChat.addEventListener('click', () => {
    elements.chatMessages.innerHTML = '';
    state.chatHistory = [];
    addSystemMessage('Chat history cleared.');
  });

  // Terminal Clear
  elements.btnClearTerminal.addEventListener('click', () => {
    elements.terminalOutput.textContent = '';
  });

  // Git / Version Control
  elements.btnRefreshGit.addEventListener('click', loadGitStatus);
  elements.btnGitClone.addEventListener('click', cloneGitRepo);
  elements.btnGitPull.addEventListener('click', () => syncGit('pull'));
  elements.btnGitCommitPush.addEventListener('click', () => syncGit('commit'));
  elements.btnGitDisconnect.addEventListener('click', disconnectGitRepo);
}

// 3. File Explorer Manager
async function loadFiles() {
  try {
    const response = await fetch('/api/files');
    const data = await response.json();
    if (data.success) {
      state.files = data.files;
      renderFileTree();
    }
  } catch (error) {
    console.error('Error fetching files:', error);
  }
}

function renderFileTree() {
  elements.fileExplorerTree.innerHTML = '';
  if (state.files.length === 0) {
    elements.fileExplorerTree.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <p>Workspace is empty</p>
      </div>
    `;
    return;
  }

  const renderNode = (node, depth = 0) => {
    const container = document.createElement('div');
    const item = document.createElement('div');
    item.className = `file-item ${state.currentFilePath === node.path ? 'selected' : ''}`;
    item.style.paddingLeft = `${depth * 15 + 10}px`;

    const icon = document.createElement('i');
    if (node.type === 'directory') {
      const isExpanded = state.expandedFolders.has(node.path);
      icon.className = isExpanded ? 'fa-solid fa-folder-open' : 'fa-solid fa-folder';
    } else {
      const ext = node.name.split('.').pop().toLowerCase();
      if (['html', 'css', 'js', 'json', 'py', 'ts'].includes(ext)) {
        icon.className = 'fa-solid fa-file-code';
      } else if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext)) {
        icon.className = 'fa-solid fa-image';
      } else {
        icon.className = 'fa-solid fa-file';
      }
    }

    const infoSpan = document.createElement('div');
    infoSpan.className = 'file-info';
    infoSpan.appendChild(icon);
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    infoSpan.appendChild(nameSpan);
    
    item.appendChild(infoSpan);

    // Actions (Delete)
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-file-delete';
    btnDel.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    btnDel.title = 'Delete';
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFile(node.path);
    });
    actions.appendChild(btnDel);
    item.appendChild(actions);

    item.addEventListener('click', () => {
      if (node.type === 'directory') {
        if (state.expandedFolders.has(node.path)) {
          state.expandedFolders.delete(node.path);
        } else {
          state.expandedFolders.add(node.path);
        }
        renderFileTree();
      } else {
        openFile(node.path);
      }
    });

    container.appendChild(item);

    if (node.type === 'directory' && state.expandedFolders.has(node.path) && node.children) {
      const childrenContainer = document.createElement('div');
      node.children.forEach(child => {
        childrenContainer.appendChild(renderNode(child, depth + 1));
      });
      container.appendChild(childrenContainer);
    }

    return container;
  };

  state.files.forEach(node => {
    elements.fileExplorerTree.appendChild(renderNode(node));
  });
}

async function openFile(relPath) {
  // Check if target is an image type
  const ext = relPath.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext)) {
    // Open in Image Viewer Side Panel
    elements.imageViewerImg.src = `/workspace-preview/${relPath}?t=${Date.now()}`;
    elements.imageViewerTitle.innerHTML = `<i class="fa-solid fa-image"></i> ${relPath}`;
    elements.panelImageViewer.classList.add('active');
    
    // On mobile viewports, route focus to the Image Viewer tab
    if (window.innerWidth <= 1024) {
      elements.panelSections.forEach(panel => {
        if (panel.id === 'panel-image-viewer') {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });
      elements.navItems.forEach(i => i.classList.remove('active'));
    }
    renderFileTree();
    return;
  }

  // Handle standard text file opening
  try {
    const response = await fetch(`/api/file-content?path=${encodeURIComponent(relPath)}`);
    const data = await response.json();
    if (data.success) {
      state.currentFilePath = relPath;
      elements.activeFilename.innerHTML = `<i class="fa-solid fa-file-code"></i> ${relPath}`;
      elements.editorTextarea.value = data.content;
      elements.editorTextarea.disabled = false;
      elements.btnSaveFile.disabled = false;
      
      updateEditorGutter();
      renderFileTree(); // Refresh list to update selected highlight

      // If on mobile, slide to the Editor panel
      if (window.innerWidth <= 1024) {
        document.querySelector('[data-target="panel-editor"]').click();
      }
    }
  } catch (error) {
    console.error('Error opening file:', error);
  }
}

async function saveCurrentFile() {
  if (!state.currentFilePath) return;
  const content = elements.editorTextarea.value;
  try {
    const response = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.currentFilePath, content })
    });
    const data = await response.json();
    if (data.success) {
      const origText = elements.btnSaveFile.innerHTML;
      elements.btnSaveFile.innerHTML = '<i class="fa-solid fa-circle-check"></i> Saved';
      elements.btnSaveFile.style.background = 'hsl(var(--success))';
      setTimeout(() => {
        elements.btnSaveFile.innerHTML = origText;
        elements.btnSaveFile.style.background = '';
      }, 1500);
      loadFiles();
    }
  } catch (error) {
    console.error('Error saving file:', error);
  }
}

async function deleteFile(relPath) {
  if (!confirm(`Are you sure you want to delete ${relPath}?`)) return;
  try {
    const response = await fetch('/api/files/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath })
    });
    const data = await response.json();
    if (data.success) {
      if (state.currentFilePath === relPath) {
        state.currentFilePath = '';
        elements.activeFilename.innerHTML = '<i class="fa-solid fa-code"></i> Editor (No File Open)';
        elements.editorTextarea.value = '';
        elements.editorTextarea.disabled = true;
        elements.btnSaveFile.disabled = true;
        updateEditorGutter();
      }
      // Hide Image Viewer if the deleted file was currently being viewed
      if (elements.imageViewerTitle.textContent.includes(relPath)) {
        elements.panelImageViewer.classList.remove('active');
      }
      loadFiles();
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
}

async function createNewFilePrompt() {
  const filename = prompt('Enter name for the new file (e.g. index.html or src/app.js):');
  if (!filename) return;
  try {
    const response = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filename, content: '' })
    });
    const data = await response.json();
    if (data.success) {
      loadFiles();
      openFile(filename);
    }
  } catch (error) {
    console.error('Error creating file:', error);
  }
}

function createNewFolderPrompt() {
  const foldername = prompt('Enter name for the new folder:');
  if (!foldername) return;
  // Create folder implicitly by writing an empty placeholder .keep file inside it
  const keepFilePath = `${foldername.replace(/\/$/, '')}/.keep`;
  fetch('/api/files/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: keepFilePath, content: '' })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      loadFiles();
    }
  })
  .catch(err => console.error('Error creating folder:', err));
}

// Upload file pipeline
async function handleUpload(fileList) {
  if (fileList.length === 0) return;

  const origHTML = elements.btnUploadMenu.innerHTML;
  elements.btnUploadMenu.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  elements.btnUploadMenu.disabled = true;

  const uploadFile = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target.result;
        const commaIdx = dataUrl.indexOf(',');
        const base64 = dataUrl.substring(commaIdx + 1);
        
        // Preservation of webkitRelativePath for folder structures
        const targetPath = file.webkitRelativePath || file.name;
        
        try {
          const response = await fetch('/api/files/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: targetPath,
              content: base64,
              isBase64: true
            })
          });
          resolve(await response.json());
        } catch (err) {
          console.error('Upload error:', err);
          resolve({ success: false, error: err.message });
        }
      };
      reader.onerror = () => resolve({ success: false, error: 'Read error' });
      reader.readAsDataURL(file);
    });
  };

  let successCount = 0;
  for (let i = 0; i < fileList.length; i++) {
    const res = await uploadFile(fileList[i]);
    if (res && res.success) {
      successCount++;
    }
  }

  // Restore button state
  elements.btnUploadMenu.innerHTML = origHTML;
  elements.btnUploadMenu.disabled = false;
  elements.inputUploadFiles.value = '';
  elements.inputUploadFolder.value = '';
  elements.uploadDropdown.classList.remove('active');

  loadFiles();
  addSystemMessage(`Successfully uploaded ${successCount} of ${fileList.length} files.`);
}

// Editor gutter line counter
function updateEditorGutter() {
  const lines = elements.editorTextarea.value.split('\n');
  const lineCount = lines.length;
  let gutterContent = '';
  for (let i = 1; i <= lineCount; i++) {
    gutterContent += i + '\n';
  }
  elements.editorGutter.textContent = gutterContent;
  elements.editorGutter.scrollTop = elements.editorTextarea.scrollTop;
}

// 4. AI Coding Agent Interface
async function sendMessageToAgent() {
  const messageText = elements.chatInput.value.trim();
  if (!messageText) return;

  let activeKey = '';
  if (state.provider === 'gemini') activeKey = state.apiKeyGemini;
  else if (state.provider === 'openai') activeKey = state.apiKeyOpenai;
  else if (state.provider === 'anthropic') activeKey = state.apiKeyAnthropic;

  if (!activeKey) {
    elements.settingsModal.classList.add('active');
    alert(`Please enter your ${state.provider.toUpperCase()} API Key in the settings first!`);
    return;
  }

  state.pendingUserMessage = messageText;

  // Add User Message to Chat UI
  appendMessage('user', messageText);
  elements.chatInput.value = '';
  
  // Show Loading Status
  elements.agentStatusBanner.classList.remove('hidden');
  elements.agentStatusText.textContent = 'Thinking...';
  
  const currentToolCallBlock = { el: null, name: '' };

  try {
    // Send request to server SSE endpoint
    const response = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: messageText,
        history: state.chatHistory,
        apiKey: activeKey,
        model: state.model,
        provider: state.provider
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partialLine = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = (partialLine + chunk).split('\n');
      partialLine = lines.pop(); // Keep partial line for next iteration

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith('event: ') || line.startsWith('data: ')) {
          // Parse Server Sent Events format
          const type = line.startsWith('event: ') ? 'event' : 'data';
          const content = line.substring(line.indexOf(': ') + 2);
          
          if (type === 'data') {
            const dataObj = JSON.parse(content);
            handleAgentSSEData(dataObj, currentToolCallBlock);
          }
        }
      }
    }
  } catch (error) {
    console.error('SSE connection error:', error);
    appendMessage('agent', `⚠️ Error calling agent: ${error.message}`);
    elements.agentStatusBanner.classList.add('hidden');
  }
}

function handleAgentSSEData(data, currentToolCallBlock) {
  if (data.status === 'started') {
    elements.agentStatusText.textContent = data.message;
  }
  else if (data.status === 'tool_start') {
    elements.agentStatusText.textContent = `Running tool ${data.tool}...`;
    
    // Add a status tag inside chat
    const toolEl = document.createElement('div');
    toolEl.className = 'tool-tag';
    toolEl.innerHTML = `<i class="fa-solid fa-cog fa-spin"></i> Executing: <strong>${data.tool}</strong> ${data.args.path || data.args.command || ''}`;
    elements.chatMessages.appendChild(toolEl);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    currentToolCallBlock.el = toolEl;
    currentToolCallBlock.name = data.tool;
  }
  else if (data.status === 'tool_end') {
    elements.agentStatusText.textContent = `Completed ${data.tool}`;
    
    if (currentToolCallBlock.el) {
      currentToolCallBlock.el.className = 'tool-tag done';
      currentToolCallBlock.el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Completed: <strong>${data.tool}</strong>`;
    }
    loadFiles(); // Refresh workspace file list in background
  }
  else if (data.status === 'completed') {
    elements.agentStatusBanner.classList.add('hidden');
    appendMessage('agent', data.text);
    
    // Store message in state history (System instruction is handled on backend)
    state.chatHistory.push({ role: 'user', parts: [{ text: state.pendingUserMessage }] });
    state.chatHistory.push({ role: 'model', parts: [{ text: data.text }] });

    loadFiles();
  }
  else if (data.error) {
    elements.agentStatusBanner.classList.add('hidden');
    appendMessage('agent', `⚠️ System Error: ${data.error}`);
  }
}

function appendMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = text;
  
  msgDiv.appendChild(contentDiv);
  elements.chatMessages.appendChild(msgDiv);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message system';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = text;
  msgDiv.appendChild(contentDiv);
  elements.chatMessages.appendChild(msgDiv);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// 5. Terminal Engine
let terminalSocket = null;
function initTerminalWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws/terminal`;
  
  terminalSocket = new WebSocket(wsUrl);

  terminalSocket.onopen = () => {
    const banner = 
`\r\n` +
` _____             _        _         ___  ____  _____ \r\n` +
`|  __ \\\\           | |      | |       |_ _||  _ \\\\|  ___|\r\n` +
`| |__) | ___   ___| | __ __| |_ ______ | | | | | | |_   \r\n` +
`|  ___/ / _ \\\\ / __| |/ // _\` | __|______|| | | | | |  _|  \r\n` +
`| |    | (_) | (__|   <| (_| | |_      _| |_| |_| | |___ \r\n` +
`|_|     \\\\___/ \\\\___|_|\\\\_\\\\\\\\__,_|\\\\__|    |___|____/  |_____|\r\n` +
`\r\n` +
`=== Terminal Session Connected ===\r\n\r\n`;
    writeToTerminal(banner);
  };

  terminalSocket.onmessage = (event) => {
    const parsed = JSON.parse(event.data);
    if (parsed.type === 'output') {
      writeToTerminal(parsed.data);
    } else if (parsed.type === 'exit') {
      writeToTerminal(parsed.data);
    }
  };

  terminalSocket.onclose = () => {
    writeToTerminal('\r\n=== Terminal Disconnected. Reconnecting... ===\r\n');
    setTimeout(initTerminalWebSocket, 3000);
  };

  elements.terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const command = elements.terminalInput.value;
      if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
        terminalSocket.send(JSON.stringify({ type: 'input', data: command + '\r\n' }));
      }
      elements.terminalInput.value = '';
    }
  });
}

function writeToTerminal(data) {
  // Convert standard newlines for terminal display
  const cleanData = data.replace(/\n/g, '\r\n');
  elements.terminalOutput.textContent += cleanData;
  elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
}

// Git Helper Functions
async function loadGitStatus() {
  try {
    const response = await fetch('/api/git/status');
    const data = await response.json();
    if (data.success) {
      if (data.isRepo) {
        elements.gitEmptyState.classList.add('hidden');
        elements.gitActiveState.classList.remove('hidden');
        elements.gitBranchName.textContent = data.branch;
        
        const count = data.files.length;
        elements.gitChangesCount.textContent = count;
        
        elements.gitChangesList.innerHTML = '';
        if (count === 0) {
          elements.gitChangesList.innerHTML = '<div class="empty-state" style="padding: 10px 0;"><p style="font-size: 0.75rem;">No changes detected</p></div>';
        } else {
          data.files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'git-change-item';
            
            const pathSpan = document.createElement('span');
            pathSpan.className = 'git-change-path';
            pathSpan.textContent = file.path;
            
            const statusSpan = document.createElement('span');
            let statusClass = 'untracked';
            let statusLabel = '??';
            if (file.type === 'M') {
              statusClass = 'M';
              statusLabel = 'M';
            } else if (file.type === 'A') {
              statusClass = 'A';
              statusLabel = 'A';
            } else if (file.type === 'D') {
              statusClass = 'D';
              statusLabel = 'D';
            } else if (file.type === '??') {
              statusClass = 'untracked';
              statusLabel = '??';
            } else {
              statusClass = file.type || 'untracked';
              statusLabel = file.type || '??';
            }
            
            statusSpan.className = `git-change-status ${statusClass}`;
            statusSpan.textContent = statusLabel;
            
            item.appendChild(pathSpan);
            item.appendChild(statusSpan);
            elements.gitChangesList.appendChild(item);
          });
        }
      } else {
        elements.gitEmptyState.classList.remove('hidden');
        elements.gitActiveState.classList.add('hidden');
      }
    }
  } catch (error) {
    console.error('Error loading Git status:', error);
  }
}

async function cloneGitRepo() {
  const repoUrl = elements.inputGitUrl.value.trim();
  const token = elements.inputGitToken.value.trim();
  
  if (!repoUrl) {
    alert('Please enter a Git repository URL.');
    return;
  }
  
  const origText = elements.btnGitClone.innerHTML;
  elements.btnGitClone.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cloning...';
  elements.btnGitClone.disabled = true;
  
  try {
    const response = await fetch('/api/git/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, token })
    });
    const data = await response.json();
    if (data.success) {
      elements.inputGitUrl.value = '';
      elements.inputGitToken.value = '';
      addSystemMessage(`📦 <strong>Repository Cloned!</strong> Loaded repository from ${repoUrl}.`);
      await loadGitStatus();
      await loadFiles();
    } else {
      alert('Clone failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Clone error:', error);
    alert('Clone failed: ' + error.message);
  } finally {
    elements.btnGitClone.innerHTML = origText;
    elements.btnGitClone.disabled = false;
  }
}

async function syncGit(action) {
  if (action === 'pull') {
    const origText = elements.btnGitPull.innerHTML;
    elements.btnGitPull.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pulling...';
    elements.btnGitPull.disabled = true;
    
    try {
      const response = await fetch('/api/git/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull' })
      });
      const data = await response.json();
      if (data.success) {
        addSystemMessage('📥 <strong>Git Pull Successful!</strong> Workspace files synchronized with remote.');
        await loadGitStatus();
        await loadFiles();
      } else {
        alert('Git pull failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Git pull error:', error);
      alert('Git pull failed: ' + error.message);
    } finally {
      elements.btnGitPull.innerHTML = origText;
      elements.btnGitPull.disabled = false;
    }
  } else if (action === 'commit') {
    const commitMessage = elements.inputGitCommitMsg.value.trim();
    if (!commitMessage) {
      alert('Please enter a commit message.');
      return;
    }
    
    const origText = elements.btnGitCommitPush.innerHTML;
    elements.btnGitCommitPush.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pushing...';
    elements.btnGitCommitPush.disabled = true;
    
    try {
      const response = await fetch('/api/git/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', commitMessage })
      });
      const data = await response.json();
      if (data.success) {
        elements.inputGitCommitMsg.value = '';
        addSystemMessage('📤 <strong>Git Commit & Push Successful!</strong> Changes pushed to remote.');
        await loadGitStatus();
      } else {
        alert('Git push failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Git commit & push error:', error);
      alert('Git commit & push failed: ' + error.message);
    } finally {
      elements.btnGitCommitPush.innerHTML = origText;
      elements.btnGitCommitPush.disabled = false;
    }
  }
}

async function disconnectGitRepo() {
  if (!confirm('Are you sure you want to stop tracking this Git repository? This will not delete your files, but it will remove the Git version control connection.')) {
    return;
  }
  
  const origText = elements.btnGitDisconnect.innerHTML;
  elements.btnGitDisconnect.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disconnecting...';
  elements.btnGitDisconnect.disabled = true;
  
  try {
    const response = await fetch('/api/git/disconnect', { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      addSystemMessage('🔌 <strong>Git Disconnected!</strong> Git version control is no longer tracking this directory.');
      await loadGitStatus();
    } else {
      alert('Failed to disconnect: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Git disconnect error:', error);
    alert('Failed to disconnect: ' + error.message);
  } finally {
    elements.btnGitDisconnect.innerHTML = origText;
    elements.btnGitDisconnect.disabled = false;
  }
}

function initSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('col-sidebar');
  
  if (!resizer || !sidebar) return;
  
  // Load saved width
  const savedWidth = localStorage.getItem('pocket_ide_sidebar_width');
  if (savedWidth && window.innerWidth > 1024) {
    sidebar.style.width = savedWidth;
  }
  
  let isDragging = false;
  
  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const workspaceRect = document.querySelector('.workspace').getBoundingClientRect();
    const newWidth = e.clientX - workspaceRect.left;
    
    // Limits: min 220px, max 600px
    if (newWidth >= 220 && newWidth <= 600) {
      sidebar.style.width = `${newWidth}px`;
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('pocket_ide_sidebar_width', sidebar.style.width);
    }
  });
}

function initEditorResizer() {
  const resizer = document.getElementById('editor-resizer');
  const editorRow = document.getElementById('editor-row');
  
  if (!resizer || !editorRow) return;
  
  // Load saved height
  const savedHeight = localStorage.getItem('pocket_ide_editor_height');
  if (savedHeight && window.innerWidth > 1024) {
    editorRow.style.height = savedHeight;
  }
  
  let isDragging = false;
  
  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizer.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const colMainRect = document.getElementById('col-main').getBoundingClientRect();
    const newHeight = e.clientY - colMainRect.top;
    
    // Limits: min 150px, max (colMain height - 100px)
    if (newHeight >= 150 && newHeight <= (colMainRect.height - 100)) {
      editorRow.style.height = `${newHeight}px`;
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('pocket_ide_editor_height', editorRow.style.height);
    }
  });
}

// Start
window.addEventListener('DOMContentLoaded', init);
