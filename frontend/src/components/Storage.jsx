import { useState } from 'react'
import Editor from '@monaco-editor/react'
import axios from 'axios'
import DynamicConnectorForm from './DynamicConnectorForm'
import './Storage.css'

function Storage() {
  const [mode, setMode] = useState('form') // 'form' or 'json'
  const [name, setName] = useState('')
  const [content, setContent] = useState('{\n  \n}')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !content.trim()) return

    // Validate JSON
    try {
      JSON.parse(content)
    } catch (err) {
      setError('Invalid JSON: ' + err.message)
      return
    }

    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const res = await axios.post('/api/add-to-storage', {
        Name: name,
        Content: content
      })
      setResponse(res.data)
      setName('')
      setContent('{\n  \n}')
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFormGenerate = async (jsonData, connectorName) => {
    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const res = await axios.post('/api/add-to-storage', {
        Name: connectorName,
        Content: JSON.stringify(jsonData, null, 2)
      })
      setResponse(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="storage-container">
      <h2>Add Connector to Storage</h2>
      <p className="description">
        Save a connector JSON to the storage API. Choose between Form Builder or JSON Editor.
      </p>

      {/* Mode Toggle */}
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

      {/* Form Mode */}
      {mode === 'form' && (
        <DynamicConnectorForm onGenerate={handleFormGenerate} />
      )}

      {/* JSON Mode */}
      {mode === 'json' && (
        <form onSubmit={handleSubmit} className="storage-form">
          <div className="form-group">
            <label htmlFor="name">Connector Name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., monday-connector.json"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>Connector JSON</label>
            <div className="editor-wrapper">
              <Editor
                height="400px"
                defaultLanguage="json"
                value={content}
                onChange={(value) => setContent(value || '')}
                theme="vs-light"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true
                }}
              />
            </div>
          </div>

          <button type="submit" disabled={loading || !name.trim() || !content.trim()} className="btn-primary">
            {loading ? 'Saving...' : 'Save to Storage'}
          </button>
        </form>
      )}

      {/* Status Messages */}
      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {response && (
        <div className="success-box">
          <strong>Success!</strong> Connector saved to storage.
          <pre className="response-data">{JSON.stringify(response, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

export default Storage
