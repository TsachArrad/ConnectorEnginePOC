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
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
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
                  onClick={() => handleFileSelect(filePath)}
                >
                  {filePath}
                </li>
              ))}
            </ul>
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
        </>
      )}
    </div>
  );
}
