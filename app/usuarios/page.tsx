import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GestaoUsuarios from "../components/GestaoUsuarios";

export default async function UsuariosPage() {
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

  if (perfil?.role !== "admin") redirect("/");

  return <GestaoUsuarios nome={perfil?.nome ?? user.email ?? "Admin"} />;
}
