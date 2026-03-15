import { useState } from 'react'
import axios from 'axios'
import './Chat.css'

function Chat() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [apiDocs, setApiDocs] = useState([''])
  const [documentation, setDocumentation] = useState([''])
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)

  const handleAddApiDoc = () => {
    setApiDocs([...apiDocs, ''])
  }

  const handleRemoveApiDoc = (index) => {
    if (apiDocs.length > 1) {
      setApiDocs(apiDocs.filter((_, i) => i !== index))
    }
  }

  const handleApiDocChange = (index, value) => {
    const newApiDocs = [...apiDocs]
    newApiDocs[index] = value
    setApiDocs(newApiDocs)
  }

  const handleAddDocumentation = () => {
    setDocumentation([...documentation, ''])
  }

  const handleRemoveDocumentation = (index) => {
    if (documentation.length > 1) {
      setDocumentation(documentation.filter((_, i) => i !== index))
    }
  }

  const handleDocumentationChange = (index, value) => {
    const newDocumentation = [...documentation]
    newDocumentation[index] = value
    setDocumentation(newDocumentation)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const apiDocsString = apiDocs.filter(doc => doc.trim()).join(' + ')
      const documentationString = documentation.filter(doc => doc.trim()).join(' + ')
      
      const res = await axios.post('/api/chat', {
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        ...(model && { model }),
        ...(apiDocsString && { api_docs: apiDocsString }),
        ...(documentationString && { documentation: documentationString })
      })
      setResponse(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-container">
      <h2>Generate Connector</h2>
      <p className="description">
        Describe the connector you want to create. The AI will generate a complete connector JSON with validation.
      </p>

      <form onSubmit={handleSubmit} className="chat-form">
        <div className="form-group">
          <label htmlFor="prompt">What connector do you need?</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Example: Create a Monday.com connector that fetches tasks from a board..."
            rows={6}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>API Documentation Links (optional)</label>
          {apiDocs.map((doc, index) => (
            <div key={index} className="api-doc-input-group">
              <input
                type="text"
                value={doc}
                onChange={(e) => handleApiDocChange(index, e.target.value)}
                placeholder="https://api-docs.example.com/reference"
                disabled={loading}
                className="api-doc-input"
              />
              {apiDocs.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveApiDoc(index)}
                  disabled={loading}
                  className="btn-remove"
                  title="Remove"
                >
                  −
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddApiDoc}
            disabled={loading}
            className="btn-add"
          >
            + Add Another Link
          </button>
          <small className="form-hint">Add links to API documentation to help generate more accurate connectors</small>
        </div>

        <div className="form-group">
          <label>Additional Documentation (optional)</label>
          {documentation.map((doc, index) => (
            <div key={index} className="api-doc-input-group">
              <input
                type="text"
                value={doc}
                onChange={(e) => handleDocumentationChange(index, e.target.value)}
                placeholder="https://docs.example.com/guide or paste documentation text"
                disabled={loading}
                className="api-doc-input"
              />
              {documentation.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveDocumentation(index)}
                  disabled={loading}
                  className="btn-remove"
                  title="Remove"
                >
                  −
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddDocumentation}
            disabled={loading}
            className="btn-add"
          >
            + Add Another Documentation
          </button>
          <small className="form-hint">Add links or text snippets from documentation, guides, or specifications</small>
        </div>

        <div className="form-group">
          <label htmlFor="model">Model (optional)</label>
          <input
            id="model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave empty for default"
            disabled={loading}
          />
        </div>

        <button type="submit" disabled={loading || !prompt.trim()} className="btn-primary">
          {loading ? 'Generating...' : 'Generate Connector'}
        </button>
      </form>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {response && (
        <div className="response-box">
          <h3>Generated Connector</h3>
          <div className="response-meta">
            <span>Model: {response.model}</span>
          </div>
          <pre className="json-output">{response.reply}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(response.reply)}
            className="btn-secondary"
          >
            Copy to Clipboard
          </button>
        </div>
      )}
    </div>
  )
}

export default Chat
