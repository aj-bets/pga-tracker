import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

// Drop-in replacement for window.storage used by the artifact code.
// Stores everything in a single key/value table called `kv_store`.
export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from('kv_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`Key not found: ${key}`);
    return { key, value: data.value, shared: false };
  },

  async set(key, value) {
    const { error } = await supabase
      .from('kv_store')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return { key, value, shared: false };
  },

  async delete(key) {
    const { error } = await supabase
      .from('kv_store')
      .delete()
      .eq('key', key);
    if (error) throw error;
    return { key, deleted: true, shared: false };
  },

  async list(prefix = '') {
    const { data, error } = await supabase
      .from('kv_store')
      .select('key')
      .like('key', `${prefix}%`);
    if (error) throw error;
    return { keys: data.map(r => r.key), prefix, shared: false };
  },
};
