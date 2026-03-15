import { useState, useRef } from 'react'
import Editor from '@monaco-editor/react'
import axios from 'axios'
import DynamicConnectorEditor from './DynamicConnectorEditor'
import './RunEngine.css'

function RunEngine() {
  const [mode, setMode] = useState('form') // 'form' or 'json'
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [connectorFull, setConnectorFull] = useState(null)
  const [lastRunConnector, setLastRunConnector] = useState(null)
  const [editableJson, setEditableJson] = useState('')
  const [response, setResponse] = useState(null)
  const [sdkPayload, setSdkPayload] = useState('')
  const [includeConnectorContext, setIncludeConnectorContext] = useState(false)
  const [sendingSdkPayload, setSendingSdkPayload] = useState(false)
  const [sdkSendResult, setSdkSendResult] = useState(null)
  const [solutionHint, setSolutionHint] = useState('')
  const [enableInternetSearch, setEnableInternetSearch] = useState(false)
  const [error, setError] = useState(null)
  const editorRef = useRef(null)

  const handleFetch = async (e) => {
    e.preventDefault()
    if (!fileName.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)
    setSdkPayload('')
    setSdkSendResult(null)
    setIncludeConnectorContext(false)
    setConnectorFull(null)
    setLastRunConnector(null)

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

  const handleRun = async (customConnector = null) => {
    if (!connectorFull) return

    setRunning(true)
    setError(null)
    setResponse(null)
    setSdkPayload('')
    setSdkSendResult(null)

    try {
      let editedConnector

      if (customConnector) {
        // Use the connector passed from the form
        editedConnector = customConnector
      } else {
        // Get the latest editor content (JSON mode)
        const currentJson = editorRef.current
          ? editorRef.current.getValue()
          : editableJson

        try {
          editedConnector = JSON.parse(currentJson)
        } catch {
          setError('Invalid JSON — please fix syntax errors before running')
          setRunning(false)
          return
        }
      }

      // Re-attach the original files
      editedConnector.files = connectorFull.files
      setLastRunConnector(editedConnector)

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

  const handleFormUpdate = (updatedConnector) => {
    // Update the JSON editor with form changes (for sync)
    const { files, ...withoutFiles } = updatedConnector
    setEditableJson(JSON.stringify(withoutFiles, null, 2))
  }

  const handleEditorMount = (editor) => {
    editorRef.current = editor
  }

  const buildSdkPayload = () => {
    if (!response) return

    const payload = {
      decision_required: true,
      source: 'run-engine-with-json',
      timestamp: new Date().toISOString(),
      file_name: fileName || null,
      docker_response: response,
      enable_internet_search: enableInternetSearch,
    }

    if (solutionHint.trim()) {
      payload.solution_hint = solutionHint.trim()
    }

    if (includeConnectorContext && lastRunConnector) {
      payload.connector_json = lastRunConnector
    }

    setSdkPayload(JSON.stringify(payload, null, 2))
    setSdkSendResult(null)
  }

  const copySdkPayload = async () => {
    if (!sdkPayload) return
    try {
      await navigator.clipboard.writeText(sdkPayload)
    } catch {
      setError('Could not copy SDK payload to clipboard')
    }
  }

  const sendSdkPayload = async () => {
    if (!sdkPayload) return

    setSendingSdkPayload(true)
    setError(null)

    try {
      const parsedPayload = JSON.parse(sdkPayload)
      const res = await axios.post('/api/submit-sdk-context', parsedPayload)
      setSdkSendResult(res.data)
      
      // If model returned fixed code, automatically update the connector
      if (res.data.fixed_connector) {
        const fixedConnector = res.data.fixed_connector
        const { files, ...withoutFiles } = fixedConnector
        setEditableJson(JSON.stringify(withoutFiles, null, 2))
        alert(res.data.message || '✅ Code fixed successfully! The connector has been updated with the fixes. You can now test it again.')
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
      setSdkSendResult(null)
    } finally {
      setSendingSdkPayload(false)
    }
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

      {/* Mode Toggle */}
      {connectorFull && !response && (
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-btn ${mode === 'form' ? 'active' : ''}`}
            onClick={() => setMode('form')}
          >
            📝 Form Builder
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === 'json' ? 'active' : ''}`}
            onClick={() => setMode('json')}
          >
            📄 JSON Editor
          </button>
        </div>
      )}

      {/* Form Mode */}
      {connectorFull && !response && mode === 'form' && (
        <div className="editor-section">
          <DynamicConnectorEditor
            connector={connectorFull}
            onUpdate={handleFormUpdate}
            onRun={handleRun}
            running={running}
          />
        </div>
      )}

      {/* JSON Mode */}
      {connectorFull && !response && mode === 'json' && (
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
            <button onClick={() => handleRun()} disabled={running} className="btn-primary btn-run">
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

            {
              <div className="sdk-payload-section">
                <strong>Manual SDK Decision</strong>
                <p>
                  Response details are shown above. If you decide to send them to Copilot SDK,
                  prepare a structured payload first.
                </p>
                <label className="sdk-toggle-label">
                  <input
                    type="checkbox"
                    checked={includeConnectorContext}
                    onChange={(e) => setIncludeConnectorContext(e.target.checked)}
                  />
                  Include connector JSON context (optional second pass)
                </label>
                <div className="sdk-hint-section">
                  <label className="sdk-hint-label">Solution Hint (optional):</label>
                  <textarea
                    className="sdk-hint-textarea"
                    placeholder="Provide guidance to direct the AI toward a specific solution..."
                    value={solutionHint}
                    onChange={(e) => setSolutionHint(e.target.value)}
                    rows={3}
                  />
                </div>
                <label className="sdk-toggle-label">
                  <input
                    type="checkbox"
                    checked={enableInternetSearch}
                    onChange={(e) => setEnableInternetSearch(e.target.checked)}
                  />
                  Enable internet search for real-time information
                </label>
                <div className="sdk-payload-actions">
                  <button onClick={buildSdkPayload} className="btn-secondary" type="button">
                    Prepare SDK Payload
                  </button>
                  {sdkPayload && (
                    <button
                      onClick={sendSdkPayload}
                      className="btn-secondary"
                      type="button"
                      disabled={sendingSdkPayload}
                    >
                      {sendingSdkPayload ? 'Sending...' : 'Send to SDK Endpoint'}
                    </button>
                  )}
                  {sdkPayload && (
                    <button onClick={copySdkPayload} className="btn-secondary" type="button">
                      Copy Payload
                    </button>
                  )}
                </div>
                {sdkPayload && (
                  <pre className="sdk-payload-pre">{sdkPayload}</pre>
                )}
                {sdkSendResult && (
                  <div className="sdk-send-result">
                    <strong>{sdkSendResult.forwarded ? 'Forwarded' : 'Received'}</strong>
                    <pre>{JSON.stringify(sdkSendResult, null, 2)}</pre>
                  </div>
                )}
              </div>
            }
          </div>
          <div className="run-engine-actions">
            <button onClick={() => {
              setResponse(null)
              setSdkPayload('')
              setSdkSendResult(null)
              setIncludeConnectorContext(false)
            }} className="btn-primary">
              Back to Editor
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default RunEngine
