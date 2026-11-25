import { createClient } from "@supabase/supabase-js";

export const auth = createClient(
  "https://sfheqjnxlkygjfohoybo.supabase.co",
  "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af",
  {
    auth: {
      storageKey: "crazymoe-studio-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit"
    }
  }
).auth;
