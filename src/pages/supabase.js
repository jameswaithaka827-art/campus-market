import { createClient } from "@supabase/supabase-js";

// 🔥 Replace these with your real Supabase values
const supabaseUrl = "https://YOUR_PROJECT_REF.supabase.co";
const supabaseKey = "sb_publishable_8eyL0GOD-saEVG29fpjoAg_noR-I1xa";

export const supabase = createClient(supabaseUrl, supabaseKey);