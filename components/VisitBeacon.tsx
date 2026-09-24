"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function VisitBeacon() {
  useEffect(() => {
    supabase.from("app_settings").update({ last_seen_at: new Date().toISOString() }).eq("id", 1);
  }, []);

  return null;
}
