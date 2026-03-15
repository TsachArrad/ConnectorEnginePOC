import { useState, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import './Debug.css';

export default function Debug() {
  const [fileName, setFileName] = useState('');
  const [connectorData, setConnectorData] = useState(null);
  const [editedFiles, setEditedFiles] = useState({});
  const [selectedFile, setSelectedFile] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [fixErrorText, setFixErrorText] = useState('');
  const [selectedForFix, setSelectedForFix] = useState('');
  const [fixedCode, setFixedCode] = useState('');
  const [solutionHint, setSolutionHint] = useState('');
  const [enableInternetSearch, setEnableInternetSearch] = useState(false);
  const currentCodeRef = useRef('');

  const loadConnector = async () => {
    if (!fileName.trim()) {
      setError('Please enter a connector file name');
      return;
    }

    setLoading(true);
    setError('');
    setSaveMessage('');

    try {
      const url = `https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/get-file/${encodeURIComponent(fileName)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load connector: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const files = data.files || {};

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found in connector');
      }

      setConnectorData(data);
      setEditedFiles({ ...files });
      setSelectedFile('');
      setSelectedForFix('');
      setFixedCode('');
      setFixErrorText('');
      currentCodeRef.current = '';
    } catch (err) {
      setError(err.message);
      setConnectorData(null);
      setEditedFiles({});
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (filePath) => {
    // Save current edits before switching
    if (selectedFile) {
      setEditedFiles(prev => ({ ...prev, [selectedFile]: currentCodeRef.current }));
    }
    setSelectedFile(filePath);
    currentCodeRef.current = editedFiles[filePath] || '';
    setSaveMessage('');
  };

  const handleEditorChange = useCallback((value) => {
    currentCodeRef.current = value || '';
    setSaveMessage('');
  }, []);

  const handleSaveAll = async () => {
    if (!connectorData) {
      setError('No connector loaded');
      return;
    }

    // Build the latest editedFiles including current editor content
    const latestFiles = { ...editedFiles };
    if (selectedFile) {
      latestFiles[selectedFile] = currentCodeRef.current;
    }

    const changedFiles = Object.keys(latestFiles).filter(
      key => latestFiles[key] !== (connectorData.files || {})[key]
    );

    const message = changedFiles.length > 0
      ? `You are about to save changes to ${changedFiles.length} file(s):\n\n${changedFiles.map(f => `  - ${f}`).join('\n')}\n\nAre you sure?`
      : 'No changes detected. Save anyway?';

    if (!window.confirm(message)) return;

    setSaving(true);
    setError('');
    setSaveMessage('');

    try {
      const updatedConnector = { ...connectorData, files: latestFiles };
      const response = await fetch('/debug/save-connector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          connector: updatedConnector
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || 'Save failed');
      }

      setConnectorData(updatedConnector);
      setEditedFiles(latestFiles);
      setSaveMessage('All files saved successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const getLanguage = (filePath) => {
    const ext = filePath.split('.').pop().toLowerCase();
    const langMap = {
      py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript',
      tsx: 'typescript', json: 'json', html: 'html', css: 'css',
      xml: 'xml', yaml: 'yaml', yml: 'yaml', md: 'markdown',
      sql: 'sql', sh: 'shell', bat: 'bat', ps1: 'powershell',
      java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c', rb: 'ruby',
      go: 'go', rs: 'rust', php: 'php', txt: 'plaintext',
    };
    return langMap[ext] || 'plaintext';
  };

  const handleSelectForFix = (filePath) => {
    setSelectedForFix(filePath);
    setFixedCode('');
  };

  const handleCopyFixedCode = () => {
    if (selectedForFix && fixedCode) {
      setEditedFiles(prev => ({ ...prev, [selectedForFix]: fixedCode }));
      currentCodeRef.current = fixedCode;
      setSelectedFile('');
      setTimeout(() => setSelectedFile(selectedForFix), 0);
      setSaveMessage('Fixed code copied to editor. Review and save when ready.');
      setFixedCode('');
    }
  };

  const handleFixError = async () => {
    if (!selectedForFix) {
      setError('Please select a file to fix');
      return;
    }
    if (!fixErrorText.trim()) {
      setError('Please enter the error text');
      return;
    }

    setFixing(true);
    setError('');
    setSaveMessage('');
    setFixedCode('');

    try {
      const response = await fetch('/fix-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: fileName,
          error: fixErrorText,
          filePath: selectedForFix,
          solution_hint: solutionHint || undefined,
          enable_internet_search: enableInternetSearch,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || 'Fix request failed');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Fix failed');
      }

      setFixedCode(data.fixed_code || '');
      setSaveMessage('Fixed code generated. Review below and click "Copy to Editor" to apply.');
    } catch (err) {
      setError(err.message);
      setFixedCode('');
    } finally {
      setFixing(false);
    }
  };

  const fileList = Object.keys(editedFiles);

  return (
    <div className="debug-container">
      <div className="debug-header">
        <h2>Debug Connector Files</h2>
        <div className="debug-load-section">
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="Enter connector file name (e.g., mondaykata.json)"
            className="debug-input"
          />
          <button onClick={loadConnector} disabled={loading} className="debug-btn">
            {loading ? 'Loading...' : 'Load Connector'}
          </button>
        </div>
      </div>

      {error && <div className="debug-error">{error}</div>}
      {saveMessage && <div className="debug-message">{saveMessage}</div>}

      {fileList.length > 0 && (
        <>
        <div className="debug-content">
          <div className="debug-sidebar">
            <h3>Files ({fileList.length})</h3>
            <ul className="debug-file-list">
              {fileList.map((filePath) => (
                <li
                  key={filePath}
                  className={selectedFile === filePath ? 'selected' : ''}
                >
                  <span className="debug-file-label" onClick={() => handleFileSelect(filePath)}>
                    {filePath}
                  </span>
                </li>
              ))}
            </ul>

            <div className="debug-fix-section">
              <h3>Fix Error</h3>
              <label className="debug-fix-label">Select file to fix (required):</label>
              <select
                className="debug-fix-select"
                value={selectedForFix}
                onChange={(e) => handleSelectForFix(e.target.value)}
              >
                <option value="">-- Select a file --</option>
                {fileList.map(fp => (
                  <option key={fp} value={fp}>{fp}</option>
                ))}
              </select>
              <textarea
                className="debug-fix-textarea"
                placeholder="Paste the error text here..."
                value={fixErrorText}
                onChange={(e) => setFixErrorText(e.target.value)}
                rows={4}
              />
              <label className="debug-fix-label">Solution hint (optional):</label>
              <textarea
                className="debug-fix-textarea"
                placeholder="Optional: Provide guidance to direct the AI (e.g., 'Try using the v2 API endpoint')..."
                value={solutionHint}
                onChange={(e) => setSolutionHint(e.target.value)}
                rows={3}
              />
              <label className="debug-fix-checkbox-label">
                <input
                  type="checkbox"
                  checked={enableInternetSearch}
                  onChange={(e) => setEnableInternetSearch(e.target.checked)}
                />
                Enable internet search for real-time information
              </label>
              <button
                onClick={handleFixError}
                disabled={fixing || !selectedForFix || !fixErrorText.trim()}
                className="debug-btn debug-btn-fix"
              >
                {fixing ? 'Fixing...' : 'Fix Error'}
              </button>
            </div>
          </div>

          <div className="debug-editor">
            {selectedFile ? (
              <>
                <div className="debug-editor-header">
                  <span className="debug-file-name">{selectedFile}</span>
                </div>
                <div className="debug-monaco-wrapper">
                  <Editor
                    key={selectedFile}
                    defaultValue={editedFiles[selectedFile] || ''}
                    language={getLanguage(selectedFile)}
                    theme="vs-dark"
                    onChange={handleEditorChange}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      automaticLayout: true,
                      readOnly: false,
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="debug-placeholder">
                <p>← Select a file from the list to view and edit its code</p>
              </div>
            )}
          </div>
        </div>

        <div className="debug-save-bar">
          <button onClick={handleSaveAll} disabled={saving} className="debug-btn debug-btn-save">
            {saving ? 'Saving...' : 'Save All Files'}
          </button>
        </div>

        {fixedCode && (
          <div className="debug-fixed-section">
            <div className="debug-fixed-header">
              <h3>Fixed Code for: {selectedForFix}</h3>
              <button onClick={handleCopyFixedCode} className="debug-btn debug-btn-copy">
                Copy to Editor
              </button>
            </div>
            <div className="debug-fixed-code">
              <pre><code>{fixedCode}</code></pre>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}
