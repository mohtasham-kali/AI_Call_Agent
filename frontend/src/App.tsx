import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, PhoneCall, Activity, Waves, Edit2, Save, Trash2, X, PhoneOff } from 'lucide-react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

interface Contact {
  id: number;
  name: string;
  phone_number: string;
  context: string;
  status: string;
  notes: string | null;
}

const API_URL = '/api';

const getCountryInfo = (number: string) => {
  const clean = number.replace(/\s/g, '');
  if (clean.startsWith('+92')) return { flag: '🇵🇰', name: 'Pakistan' };
  if (clean.startsWith('+1')) return { flag: '🇺🇸', name: 'USA' };
  if (clean.startsWith('+44')) return { flag: '🇬🇧', name: 'UK' };
  if (clean.startsWith('+971')) return { flag: '🇦🇪', name: 'UAE' };
  if (clean.startsWith('+91')) return { flag: '🇮🇳', name: 'India' };
  if (clean.startsWith('+966')) return { flag: '🇸🇦', name: 'KSA' };
  return { flag: '🌍', name: 'Global' };
};

function ContactCard({ contact, onUpdate, onDelete }: { contact: Contact, onUpdate: () => void, onDelete: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ name: contact.name, phone_number: contact.phone_number, context: contact.context });

  const country = getCountryInfo(contact.phone_number);

  const handleSave = async () => {
    try {
      await axios.put(`${API_URL}/contacts/${contact.id}`, editData);
      setIsEditing(false);
      onUpdate();
    } catch (e) {
      console.error(e);
    }
  };

  const handleHangUp = async () => {
    try {
      await axios.post(`${API_URL}/contacts/${contact.id}/hangup`);
      onUpdate();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Delete this contact?')) {
      try {
        await axios.delete(`${API_URL}/contacts/${contact.id}`);
        onDelete();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const getStatusColor = (status: string) => {
    if (status === 'calling') return 'text-blue-400 bg-blue-500/20 border-blue-500/50';
    if (status === 'completed') return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/50';
    if (status === 'failed') return 'text-rose-400 bg-rose-500/20 border-rose-500/50';
    return 'text-amber-400 bg-amber-500/20 border-amber-500/50';
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group bg-black/40 border border-white/5 rounded-2xl p-5 hover:border-white/20 transition-all flex flex-col gap-4 relative overflow-hidden"
    >
      {contact.status === 'calling' && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 blur-[50px] -mr-10 -mt-10 pointer-events-none" />
      )}

      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-3">
          {isEditing ? (
            <div className="space-y-4 pr-10">
              <input 
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 transition-colors font-bold"
                value={editData.name}
                onChange={e => setEditData({...editData, name: e.target.value})}
                placeholder="Name"
              />
              <input 
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white font-mono text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                value={editData.phone_number}
                onChange={e => setEditData({...editData, phone_number: e.target.value})}
                placeholder="Number (e.g. +92...)"
              />
              <textarea 
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors min-h-[100px]"
                value={editData.context}
                onChange={e => setEditData({...editData, context: e.target.value})}
                placeholder="Directive / Context"
              />
              <div className="flex gap-2">
                <button onClick={handleSave} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-500/20">
                  <Save size={16} /> Save Changes
                </button>
                <button onClick={() => setIsEditing(false)} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-xl text-sm transition-all">
                  <X size={16} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-white group-hover:text-indigo-300 transition-colors">{contact.name}</h3>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] uppercase font-black tracking-widest text-neutral-500 border border-white/5">
                  ID: {contact.id}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{country.flag}</span>
                <span className="text-xs font-bold text-neutral-500 uppercase tracking-tighter">{country.name}</span>
                <p className="font-mono text-sm text-neutral-400">{contact.phone_number}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4 border border-white/5 mt-4 group-hover:bg-white/10 transition-colors">
                <p className="text-sm text-neutral-300 leading-relaxed font-medium">
                  <span className="text-neutral-500 uppercase text-xs tracking-wider mr-2 font-bold block mb-1">Directive</span>
                  {contact.context}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col items-end gap-4">
          <div className={`px-4 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${getStatusColor(contact.status)}`}>
            {contact.status === 'calling' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            )}
            {contact.status}
          </div>
          
          <div className="flex gap-2">
            {!isEditing && (
              <>
                {contact.status === 'calling' && (
                  <button 
                  onClick={handleHangUp}
                  className="p-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/30 text-rose-500 font-bold flex items-center gap-2 border border-rose-500/40 animate-pulse"
                  title="Hang Up"
                  >
                    <PhoneOff size={18} />
                    <span className="text-xs">End Call</span>
                  </button>
                )}
                <button 
                  onClick={() => setIsEditing(true)}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all border border-white/5 hover:border-white/20"
                  title="Edit Contact"
                >
                  <Edit2 size={18} />
                </button>
                <button 
                  onClick={handleDelete}
                  className="p-2.5 rounded-xl bg-rose-500/5 hover:bg-rose-500/20 text-rose-500/50 hover:text-rose-400 transition-all border border-rose-500/10 hover:border-rose-500/30"
                  title="Delete Contact"
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {contact.notes && !isEditing && (
        <div className="mt-2 p-4 border-l-2 border-emerald-500/50 bg-emerald-500/5 rounded-r-xl">
          <p className="text-sm text-emerald-100/80 leading-relaxed">
            <span className="text-emerald-500/80 uppercase text-xs tracking-wider mr-2 font-bold block mb-1">AI Output / Transcript</span>
            {contact.notes}
          </p>
        </div>
      )}
    </motion.div>
  );
}

function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [pitch, setPitch] = useState('Hello, I am calling from Nexus Voice AI...');
  const [savingPitch, setSavingPitch] = useState(false);

  const fetchPitch = async () => {
    try {
      const res = await axios.get(`${API_URL}/settings`);
      if (res.data.global_pitch) setPitch(res.data.global_pitch);
    } catch (e) { console.error(e); }
  };

  const savePitch = async () => {
    setSavingPitch(true);
    try {
      await axios.post(`${API_URL}/settings`, { global_pitch: pitch });
      alert('Pitch saved successfully');
    } catch (e) {
      console.error(e);
      alert('Failed to save pitch');
    } finally {
      setSavingPitch(false);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await axios.get(`${API_URL}/contacts`);
      setContacts(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchContacts();
    fetchPitch();
    const interval = setInterval(fetchContacts, 3000);
    return () => clearInterval(interval);
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const formData = new FormData();
    formData.append('file', acceptedFiles[0]);
    setLoading(true);
    try {
      await axios.post(`${API_URL}/upload_csv`, formData);
      fetchContacts();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'text/csv': ['.csv'] } });

  const startCalls = async () => {
    try {
      await axios.post(`${API_URL}/start_calls`);
      fetchContacts();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 font-sans overflow-hidden selection:bg-indigo-500/30 relative">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none flex justify-center items-center opacity-30">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }} 
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute w-[60vw] h-[60vw] rounded-full bg-indigo-900/40 blur-[120px]" 
          style={{ top: '-10%', left: '-10%' }}
        />
        <motion.div 
          animate={{ scale: [1, 1.5, 1], rotate: [0, -90, 0] }} 
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute w-[50vw] h-[50vw] rounded-full bg-fuchsia-900/30 blur-[100px]" 
          style={{ bottom: '-10%', right: '-10%' }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 space-y-12 relative z-10">
        <motion.header 
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col md:flex-row justify-between items-center bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-2xl shadow-2xl shadow-black/50"
        >
          <div className="flex items-center gap-4 mb-4 md:mb-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 flex items-center justify-center p-[2px]">
              <div className="w-full h-full bg-black/40 rounded-xl flex items-center justify-center backdrop-blur-sm">
                <Waves className="text-white" size={28} />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-neutral-400">
                Nexus Voice AI
              </h1>
              <p className="text-sm font-medium text-neutral-400 mt-1">Autonomous Telephony Agent Engine</p>
            </div>
          </div>

          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={startCalls}
            className="group relative flex items-center gap-3 bg-white text-black px-8 py-4 rounded-2xl font-bold shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_-15px_rgba(255,255,255,0.5)] transition-all overflow-hidden"
          >
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-indigo-500 opacity-0 group-hover:opacity-10 transition-opacity duration-500" />
            <PhoneCall size={20} className="group-hover:animate-bounce" />
            <span>Initiate Auto-Dialer</span>
          </motion.button>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 flex flex-col gap-8">
            <motion.div 
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <Activity size={20} className="text-indigo-400" />
                </div>
                <h3 className="text-lg font-bold">Global Sales Pitch</h3>
              </div>
              <textarea 
                value={pitch}
                onChange={e => setPitch(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-sm text-neutral-300 min-h-[180px] focus:outline-none focus:border-indigo-500 transition-all font-medium leading-relaxed"
                placeholder="Type your AI's objective or sales pitch here..."
              />
              <button 
                onClick={savePitch}
                disabled={savingPitch}
                className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-2xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
              >
                {savingPitch ? "Saving..." : <><Save size={18} /> Update AI Pitch</>}
              </button>
            </motion.div>

            <motion.div 
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="h-full"
            >
              <div 
                {...getRootProps()} 
                className={`relative h-full min-h-[250px] border border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer backdrop-blur-xl overflow-hidden ${
                  isDragActive ? 'border-fuchsia-500 bg-fuchsia-500/10 shadow-[0_0_50px_-20px_rgba(217,70,239,0.4)]' : 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30'
                }`}
              >
              <input {...getInputProps()} />
              <div className="relative z-10 flex flex-col items-center">
                <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} >
                  <UploadCloud size={64} className={`mb-6 ${isDragActive ? 'text-fuchsia-400' : 'text-neutral-400'}`} strokeWidth={1.5} />
                </motion.div>
                <h3 className="text-xl font-semibold text-white mb-2">Import Target List</h3>
                <p className="text-sm text-neutral-400 max-w-[200px]">
                  {isDragActive ? "Release to import..." : "Drag & drop your CSV file here, or click to browse."}
                </p>
                {loading && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 flex items-center gap-2 text-indigo-400 font-medium">
                     <Activity className="animate-spin" size={18} /> Processing...
                  </motion.div>
                )}
              </div>
              <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-white/10 rounded-tl-3xl m-4" />
              <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-white/10 rounded-br-3xl m-4" />
            </div>
          </motion.div>
        </div>

        <motion.div 
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-2 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-xl relative flex flex-col h-[700px]"
          >
            <div className="p-8 border-b border-white/10 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-2 h-8 rounded-full bg-indigo-500" />
                <h2 className="text-2xl font-bold tracking-tight text-white">Active Queue</h2>
              </div>
              <div className="bg-black/40 border border-white/10 px-4 py-2 rounded-full flex items-center gap-2 shadow-inner">
                <Activity size={18} className="text-fuchsia-400" />
                <span className="font-mono text-sm tracking-widest text-fuchsia-100 uppercase">{contacts.length} Targets</span>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4 pr-4 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {contacts.length === 0 ? (
                  <motion.div 
                    key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-neutral-500 py-20"
                  >
                    <Activity className="opacity-20 mb-4" size={64} />
                    <p>No targets found in the database.</p>
                  </motion.div>
                ) : (
                  contacts.map(c => (
                    <ContactCard 
                      key={c.id} 
                      contact={c} 
                      onUpdate={fetchContacts} 
                      onDelete={fetchContacts} 
                    />
                  ))
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default App;
