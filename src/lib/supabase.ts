import { createClient } from "@supabase/supabase-js";

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 不套泛型，避免 stub 型別與 Supabase 內部型別衝突。
// 正式使用後可執行 `npx supabase gen types typescript` 生成精確型別。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient<any>(url, anonKey);
