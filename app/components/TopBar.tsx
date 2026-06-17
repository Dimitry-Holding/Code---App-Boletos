"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function TopBar({
  nome,
  papel,
}: {
  nome: string;
  papel: string;
}) {
  const router = useRouter();

  async function sair() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="topbar">
      <span className="brand">📄 Notas Fiscais</span>
      <span className="who">
        {nome}
        <small>{papel}</small>
      </span>
      <button onClick={sair}>Sair</button>
    </div>
  );
}
