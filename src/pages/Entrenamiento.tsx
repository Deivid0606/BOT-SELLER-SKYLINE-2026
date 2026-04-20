import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

interface TrainingItem {
  id: string
  intent: string
  examples: string[]
  response: string
  is_active: boolean
  created_at: string
}

export default function Entrenamiento() {
  const { user } = useAuth()
  const [trainingData, setTrainingData] = useState<TrainingItem[]>([])
  const [intent, setIntent] = useState('')
  const [examples, setExamples] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Cargar datos existentes
  const loadTrainingData = async () => {
    if (!user) return
    
    setLoading(true)
    const { data, error } = await supabase
      .from('training_data')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error cargando:', error)
      alert('Error al cargar los datos: ' + error.message)
    } else {
      setTrainingData(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (user) {
      loadTrainingData()
    }
  }, [user])

  const handleSave = async () => {
    if (!user) {
      alert('Debes iniciar sesión')
      return
    }
    
    if (!intent.trim()) {
      alert('Por favor completa el Tema / Categoría')
      return
    }
    if (!response.trim()) {
      alert('Por favor completa la respuesta del bot')
      return
    }

    // Convertir ejemplos a array
    const examplesArray = examples
      .split('\n')
      .filter(ex => ex.trim())
      .map(ex => ex.trim())

    setSaving(true)

    if (editingId) {
      // Actualizar existente
      const { error } = await supabase
        .from('training_data')
        .update({
          intent: intent.trim(),
          examples: examplesArray,
          response: response.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', editingId)
        .eq('user_id', user.id)

      if (error) {
        console.error('Error al actualizar:', error)
        alert('Error al actualizar: ' + error.message)
      } else {
        alert('✅ Datos actualizados correctamente')
        resetForm()
        loadTrainingData()
      }
    } else {
      // Crear nuevo
      const { error } = await supabase
        .from('training_data')
        .insert({
          user_id: user.id,
          intent: intent.trim(),
          examples: examplesArray,
          response: response.trim(),
          is_active: true
        })

      if (error) {
        console.error('Error al guardar:', error)
        alert('Error al guardar: ' + error.message)
      } else {
        alert('✅ Datos guardados correctamente en Supabase')
        resetForm()
        loadTrainingData()
      }
    }
    setSaving(false)
  }

  const handleEdit = (item: TrainingItem) => {
    setIntent(item.intent)
    setResponse(item.response)
    setExamples(item.examples.join('\n'))
    setEditingId(item.id)
    document.getElementById('formulario')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este dato de entrenamiento?')) return

    setLoading(true)
    const { error } = await supabase
      .from('training_data')
      .delete()
      .eq('id', id)
      .eq('user_id', user?.id)

    if (error) {
      console.error('Error al eliminar:', error)
      alert('Error al eliminar: ' + error.message)
    } else {
      alert('✅ Dato eliminado')
      loadTrainingData()
    }
    setLoading(false)
  }

  const resetForm = () => {
    setIntent('')
    setExamples('')
    setResponse('')
    setEditingId(null)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Entrenamiento IA</h1>

      {/* Formulario */}
      <div id="formulario" className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">
          {editingId ? '✏️ Editar' : '➕ Nuevo'} Dato de Entrenamiento
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Tema / Categoría *
            </label>
            <input
              type="text"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="Ej: precio, envio, garantia, saludo"
              className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Frases de ejemplo (una por línea)
            </label>
            <textarea
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              placeholder="cuánto cuesta?&#10;precio del producto&#10;valor final"
              rows={4}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              El bot usará estas frases para identificar la intención
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Respuesta del bot *
            </label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Respuesta que dará el bot cuando detecte esta intención..."
              rows={4}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? 'Guardando...' : (editingId ? 'Actualizar' : 'Guardar')}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lista de datos existentes */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Datos de Entrenamiento</h2>
        
        {loading && <p className="text-center text-gray-400 py-8">Cargando...</p>}

        {!loading && trainingData.length === 0 && (
          <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
            <p className="mb-2">📚 Aún no hay datos de entrenamiento</p>
            <p className="text-sm">Completa el formulario arriba para agregar tu primer dato</p>
          </div>
        )}

        <div className="space-y-3">
          {trainingData.map((item) => (
            <div key={item.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
                      {item.intent}
                    </span>
                    <span className="text-xs text-gray-500">
                      {item.examples.length} ejemplos
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-2">
                    {item.response}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.examples.slice(0, 3).map((ex, idx) => (
                      <span key={idx} className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                        "{ex}"
                      </span>
                    ))}
                    {item.examples.length > 3 && (
                      <span className="text-xs text-gray-500">+{item.examples.length - 3} más</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(item)}
                    className="text-blue-400 hover:text-blue-300 text-sm px-2 py-1"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
