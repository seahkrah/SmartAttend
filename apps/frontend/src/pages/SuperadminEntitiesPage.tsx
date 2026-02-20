import React, { useState, useEffect } from 'react'
import { Users, Mail, CheckCircle, AlertCircle } from 'lucide-react'
import { apiClient } from '../services/api'
import SuperadminLayout from '../components/SuperadminLayout'


interface Entity {
  id: string
  name: string
  code: string
  email: string
  is_active: boolean
  user_count: number
  pending_approvals: number
}

const SuperadminEntitiesPage: React.FC = () => {
  const [schools, setSchools] = useState<Entity[]>([])
  const [corporates, setCorporates] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadEntities()
  }, [])

  const loadEntities = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/superadmin/entities')
      
      if (response.data) {
        setSchools(response.data.schools || [])
        setCorporates(response.data.corporates || [])
      }
    } catch (error) {
      console.error('Error loading entities:', error)
    } finally {
      setLoading(false)
    }
  }

  const EntityCard = ({ entity }: { entity: Entity }) => (
    <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h4 className="text-white font-bold text-lg">{entity.name}</h4>
          <p className="text-slate-400 text-sm">Code: {entity.code}</p>
        </div>
        {entity.is_active ? (
          <CheckCircle className="w-5 h-5 text-green-400" />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-400" />
        )}
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <Mail className="w-4 h-4 text-slate-500" />
          <p className="text-slate-300">{entity.email}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-slate-500" />
          <p className="text-slate-300">{entity.user_count} users</p>
        </div>
      </div>

      <div className="flex gap-2 pt-3 border-t border-slate-700">
        <span className={`flex-1 px-3 py-1 rounded-full text-xs font-semibold text-center ${
          entity.is_active
            ? 'bg-green-500/20 text-green-400'
            : 'bg-red-500/20 text-red-400'
        }`}>
          {entity.is_active ? 'Active' : 'Inactive'}
        </span>
        {entity.pending_approvals > 0 && (
          <span className="flex-1 px-3 py-1 rounded-full text-xs font-semibold text-center bg-yellow-500/20 text-yellow-400">
            {entity.pending_approvals} pending
          </span>
        )}
      </div>
    </div>
  )

  if (loading) {
    return (
      <SuperadminLayout currentPage="management">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading entities...</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="management">
      <div className="space-y-8">
        {/* Schools Section */}
        <div>
          <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-1 h-8 bg-blue-500 rounded-full" />
            Schools ({schools.length})
          </h3>
          {schools.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schools.map((school) => (
                <div key={school.id}>
                  <EntityCard entity={school} />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-700">
              <p className="text-slate-400">No schools found</p>
            </div>
          )}
        </div>

        {/* Corporates Section */}
        <div>
          <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-1 h-8 bg-purple-500 rounded-full" />
            Corporates ({corporates.length})
          </h3>
          {corporates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {corporates.map((corporate) => (
                <div key={corporate.id}>
                  <EntityCard entity={corporate} />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-700">
              <p className="text-slate-400">No corporates found</p>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
            <p className="text-slate-400 text-sm">Total Schools</p>
            <p className="text-4xl font-bold text-blue-400 mt-2">{schools.length}</p>
            <p className="text-xs text-slate-500 mt-2">
              {schools.filter(s => s.is_active).length} active · {schools.filter(s => !s.is_active).length} inactive
            </p>
          </div>
          <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
            <p className="text-slate-400 text-sm">Total Corporates</p>
            <p className="text-4xl font-bold text-purple-400 mt-2">{corporates.length}</p>
            <p className="text-xs text-slate-500 mt-2">
              {corporates.filter(c => c.is_active).length} active · {corporates.filter(c => !c.is_active).length} inactive
            </p>
          </div>
        </div>
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminEntitiesPage
