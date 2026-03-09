import { useState, useRef } from 'react'
import Editor from '@monaco-editor/react'
import axios from 'axios'
import './RunEngine.css'

function RunEngine() {
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [connectorFull, setConnectorFull] = useState(null)
  const [editableJson, setEditableJson] = useState('')
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)
  const editorRef = useRef(null)

  const handleFetch = async (e) => {
    e.preventDefault()
    if (!fileName.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)
    setConnectorFull(null)

    try {
      const res = await axios.get(`/api/get-file/${encodeURIComponent(fileName)}`)
      const connector = res.data

      if (!connector || !connector.files) {
        throw new Error('Connector has no files section')
      }

      setConnectorFull(connector)

      // Build editable JSON without the files section
      const { files, ...withoutFiles } = connector
      setEditableJson(JSON.stringify(withoutFiles, null, 2))
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    if (!connectorFull) return

    setRunning(true)
    setError(null)
    setResponse(null)

    try {
      // Get the latest editor content
      const currentJson = editorRef.current
        ? editorRef.current.getValue()
        : editableJson

      let editedConnector
      try {
        editedConnector = JSON.parse(currentJson)
      } catch {
        setError('Invalid JSON — please fix syntax errors before running')
        setRunning(false)
        return
      }

      // Re-attach the original files
      editedConnector.files = connectorFull.files

      const res = await axios.post('/api/run-engine-with-json', {
        connector: editedConnector
      })
      setResponse(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setRunning(false)
    }
  }

  const handleEditorMount = (editor) => {
    editorRef.current = editor
  }

  return (
    <div className="run-engine-container">
      <h2>Run Connector Engine</h2>
      <p className="description">
        Fetch a connector, review & edit its configuration, then execute it via engine.py.
      </p>

      <form onSubmit={handleFetch} className="run-engine-form">
        <div className="form-group">
          <label htmlFor="fileName">File Name</label>
          <input
            id="fileName"
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="e.g., mondaykata.json"
            disabled={loading}
          />
        </div>

        <button type="submit" disabled={loading || !fileName.trim()} className="btn-primary">
          {loading ? 'Fetching...' : 'Fetch Connector'}
        </button>
      </form>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {typeof error === 'object' ? JSON.stringify(error) : error}
        </div>
      )}

      {connectorFull && !response && (
        <div className="editor-section">
          <h3>Edit Connector JSON <span className="files-note">(files section hidden — will be included automatically)</span></h3>
          <div className="run-engine-editor-wrapper">
            <Editor
              defaultValue={editableJson}
              language="json"
              theme="vs-dark"
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                formatOnPaste: true,
              }}
            />
          </div>
          <div className="run-engine-actions">
            <button onClick={handleRun} disabled={running} className="btn-primary btn-run">
              {running ? 'Running...' : 'Run Engine'}
            </button>
          </div>
        </div>
      )}

      {response && (
        <div className={response.ok !== false ? 'success-box' : 'error-box'}>
          <h3>{response.ok !== false ? '✓ Success' : '✗ Failed'}</h3>
          <div className="result-details">
            {response.exit_code !== undefined && (
              <p><strong>Exit Code:</strong> {response.exit_code}</p>
            )}
            {response.duration_ms !== undefined && (
              <p><strong>Duration:</strong> {response.duration_ms}ms</p>
            )}
            {response.error && (
              <div className="error-details">
                <strong>Error:</strong>
                <pre>{typeof response.error === 'object' ? JSON.stringify(response.error, null, 2) : response.error}</pre>
              </div>
            )}
            {response.result !== undefined && (
              <div className="result-data">
                <strong>Result:</strong>
                <pre>{JSON.stringify(response.result, null, 2)}</pre>
              </div>
            )}
            {response.stdout && (
              <div className="output-section">
                <strong>Standard Output:</strong>
                <pre>{response.stdout}</pre>
              </div>
            )}
            {response.stderr && (
              <div className="output-section stderr">
                <strong>Standard Error:</strong>
                <pre>{response.stderr}</pre>
              </div>
            )}
          </div>
          <div className="run-engine-actions">
            <button onClick={() => setResponse(null)} className="btn-primary">
              Back to Editor
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default RunEngine
