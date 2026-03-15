import { useState, useEffect } from 'react'
import './DynamicConnectorForm.css'

function DynamicConnectorEditor({ connector, onUpdate, onRun, running }) {
  const [authFields, setAuthFields] = useState([])
  const [configTypes, setConfigTypes] = useState([])
  const [configValues, setConfigValues] = useState({})

  // Parse connector on mount or when it changes
  useEffect(() => {
    if (!connector) return

    // Parse auth
    const auth = connector.auth || {}
    const parsedAuthFields = Object.entries(auth).map(([key, value]) => ({
      key,
      value: String(value),
      type: 'string'
    }))
    setAuthFields(parsedAuthFields)

    // Parse configurationTypes
    const configurationTypes = connector.configurationTypes || {}
    const parsedConfigTypes = Object.entries(configurationTypes).map(([key, typeObj]) => ({
      key,
      type: typeObj.type || 'string',
      required: typeObj.required || false,
      default: typeObj.default !== undefined ? typeObj.default : '',
      description: typeObj.description || '',
      enum: typeObj.enum || []
    }))
    setConfigTypes(parsedConfigTypes)

    // Parse configuration values
    setConfigValues(connector.configuration || {})
  }, [connector])

  // Update auth field
  const updateAuthField = (index, field, value) => {
    const updated = [...authFields]
    updated[index][field] = value
    setAuthFields(updated)
    notifyUpdate()
  }

  // Update config value
  const updateConfigValue = (key, value, type) => {
    let parsedValue = value

    // Parse based on type
    if (type === 'integer' || type === 'number') {
      parsedValue = value === '' ? '' : Number(value)
    } else if (type === 'boolean') {
      parsedValue = value === 'true' || value === true
    } else if (type === 'object') {
      try {
        parsedValue = value === '' ? {} : JSON.parse(value)
      } catch (e) {
        parsedValue = value // Keep as string if invalid JSON
      }
    } else if (type === 'array') {
      try {
        parsedValue = value === '' ? [] : JSON.parse(value)
      } catch (e) {
        parsedValue = value // Keep as string if invalid JSON
      }
    }

    setConfigValues({ ...configValues, [key]: parsedValue })
    notifyUpdate()
  }

  // Notify parent of updates
  const notifyUpdate = () => {
    if (!onUpdate) return

    // Small delay to ensure state is updated
    setTimeout(() => {
      const updatedConnector = buildUpdatedConnector()
      onUpdate(updatedConnector)
    }, 0)
  }

  // Build the updated connector JSON
  const buildUpdatedConnector = () => {
    // Build auth object
    const auth = {}
    authFields.forEach(field => {
      if (field.key) {
        auth[field.key] = field.value
      }
    })

    // Keep original configurationTypes
    const configurationTypes = connector?.configurationTypes || {}

    // Build configuration object with actual values
    const configuration = { ...configValues }

    return {
      ...connector,
      auth,
      configurationTypes,
      configuration
    }
  }

  // Render input field based on type
  const renderConfigInput = (configType) => {
    const key = configType.key
    const value = configValues[key] !== undefined ? configValues[key] : configType.default || ''

    if (configType.enum && configType.enum.length > 0) {
      // Render dropdown for enum
      return (
        <select
          value={value}
          onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
          className="config-input"
        >
          <option value="">-- Select --</option>
          {configType.enum.map((enumVal, i) => (
            <option key={i} value={enumVal}>{enumVal}</option>
          ))}
        </select>
      )
    }

    if (configType.type === 'boolean') {
      return (
        <select
          value={String(value)}
          onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
          className="config-input"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      )
    }

    if (configType.type === 'object' || configType.type === 'array') {
      return (
        <textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
          onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
          className="config-textarea"
          placeholder={configType.type === 'object' ? '{}' : '[]'}
          rows={3}
        />
      )
    }

    // Default: text or number input
    return (
      <input
        type={configType.type === 'integer' || configType.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
        className="config-input"
        placeholder={configType.default || ''}
      />
    )
  }

  const handleRunClick = () => {
    const updatedConnector = buildUpdatedConnector()
    if (onRun) {
      onRun(updatedConnector)
    }
  }

  if (!connector) {
    return <div className="dynamic-form-container">No connector loaded</div>
  }

  return (
    <div className="dynamic-form-container">
      <h3>Edit Connector Settings</h3>
      <p className="description">
        Modify authentication and configuration values using the form below
      </p>

      {/* Auth Section */}
      {authFields.length > 0 && (
        <div className="section">
          <h3>Authentication</h3>
          {authFields.map((field, index) => (
            <div key={index} className="field-row">
              <label className="auth-field-label">{field.key}:</label>
              <input
                type="text"
                value={field.value}
                onChange={(e) => updateAuthField(index, 'value', e.target.value)}
                className="field-value"
              />
            </div>
          ))}
        </div>
      )}

      {/* Configuration Values Section */}
      {configTypes.length > 0 && (
        <div className="section">
          <h3>Configuration</h3>
          {configTypes.map((ct, index) => {
            if (!ct.key) return null

            return (
              <div key={index} className="config-value-row">
                <label className="config-label">
                  <span className="config-label-name">
                    {ct.key}
                    {ct.required && <span className="required-asterisk">*</span>}
                  </span>
                  {ct.description && (
                    <span className="config-label-desc">{ct.description}</span>
                  )}
                </label>
                {renderConfigInput(ct)}
              </div>
            )
          })}
        </div>
      )}

      {/* Run Button */}
      <div className="actions">
        <button
          type="button"
          onClick={handleRunClick}
          className="btn-generate"
          disabled={running}
        >
          {running ? 'Running...' : 'Run Engine'}
        </button>
      </div>
    </div>
  )
}

export default DynamicConnectorEditor
