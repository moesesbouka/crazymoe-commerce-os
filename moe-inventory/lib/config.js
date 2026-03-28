window.CM_CONFIG = {
  supabaseUrl: localStorage.getItem('CM_SUPABASE_URL') || '',
  supabaseKey: localStorage.getItem('CM_SUPABASE_KEY') || '',
};

window.CM_SET_CONFIG = function ({ supabaseUrl, supabaseKey }) {
  localStorage.setItem('CM_SUPABASE_URL', supabaseUrl || '');
  localStorage.setItem('CM_SUPABASE_KEY', supabaseKey || '');
  window.CM_CONFIG.supabaseUrl = supabaseUrl || '';
  window.CM_CONFIG.supabaseKey = supabaseKey || '';
};