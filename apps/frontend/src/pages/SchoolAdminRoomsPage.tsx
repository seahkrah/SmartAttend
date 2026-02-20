import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useToastStore } from '../components/Toast';
import { TenantAdminLayout } from '../components/TenantAdminLayout';
import { getErrorMessage, showSuccess } from '../utils/errorHandler';
import { useConfirmDialog } from '../components/useConfirmDialog';

interface Room {
  id: string;
  building: string;
  room_number: string;
  capacity?: number;
  floor?: string;
  room_type?: string;
}

const SchoolAdminRoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const [formData, setFormData] = useState({
    building: '',
    roomNumber: '',
    capacity: '',
    roomType: 'lecture_hall'
  });

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/rooms', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRooms(response.data.rooms);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('accessToken');
    
    try {
      if (editingRoom) {
        await axios.patch(`/api/auth/admin/school/rooms/${editingRoom.id}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        addToast({ type: 'success', title: 'Success', message: 'Room updated successfully' });
      } else {
        await axios.post('/api/auth/admin/school/rooms', formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        addToast({ type: 'success', title: 'Success', message: 'Room created successfully' });
      }
      setShowModal(false);
      setEditingRoom(null);
      setFormData({ building: '', roomNumber: '', capacity: '', roomType: 'lecture_hall' });
      fetchRooms();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: error.response?.data?.error || 'Operation failed' });
    }
  };

  const handleDelete = async (room: Room) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete Room?',
      message: `Are you sure you want to delete room "${room.building} ${room.room_number}"? This action cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`/api/auth/admin/school/rooms/${room.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      addToast({ type: 'success', title: 'Success', message: 'Room deleted successfully' });
      fetchRooms();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: error.response?.data?.error || 'Failed to delete room' });
    }
  };

  return (
    <TenantAdminLayout currentPage="rooms" platform="school">
      <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Room Management</h1>
          <p className="text-sm text-gray-600 mt-1">Manage classrooms and facilities</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + Add Room
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : rooms.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">🏫</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Rooms Found</h3>
          <p className="text-gray-500">Add your first room to get started</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {rooms.map((room) => (
            <div key={room.id} className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-gray-900">{room.building} {room.room_number}</h3>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditingRoom(room); setFormData({ building: room.building, roomNumber: room.room_number, capacity: room.capacity?.toString() || '', roomType: room.room_type || 'lecture_hall' }); setShowModal(true); }}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(room)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-600">
                <p>Capacity: {room.capacity || 'N/A'}</p>
                <p className="capitalize">{room.room_type?.replace('_', ' ') || 'Standard'}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">{editingRoom ? 'Edit Room' : 'Add New Room'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Building</label>
                <input type="text" required value={formData.building} onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Room Number</label>
                <input type="text" required value={formData.roomNumber} onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                <input type="number" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Room Type</label>
                <select value={formData.roomType} onChange={(e) => setFormData({ ...formData, roomType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}>
                  <option value="lecture_hall">Lecture Hall</option>
                  <option value="laboratory">Laboratory</option>
                  <option value="seminar_room">Seminar Room</option>
                  <option value="auditorium">Auditorium</option>
                </select>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { setShowModal(false); setEditingRoom(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {editingRoom ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    <ConfirmDialog />
    </TenantAdminLayout>
  );
};

export default SchoolAdminRoomsPage;
