import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ConductorApp from "./components/ConductorApp";
import AdminApp from "./components/AdminApp";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome, role")
    .eq("id", user.id)
    .single();

  const nome = perfil?.nome ?? user.email ?? "Usuário";
  const role = perfil?.role ?? "conductor";

  if (role === "admin") {
    return <AdminApp nome={nome} podeGerenciar={true} />;
  }

  if (role === "supervisor") {
    return <AdminApp nome={nome} podeGerenciar={false} />;
  }

  return <ConductorApp nome={nome} userId={user.id} />;
}
