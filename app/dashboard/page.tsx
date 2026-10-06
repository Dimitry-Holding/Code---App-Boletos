import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardApp from "../components/DashboardApp";

/** Dashboard de gastos: só o administrador entra (supervisor e usuário voltam para "/"). */
export default async function DashboardPage() {
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

  return <DashboardApp nome={perfil?.nome ?? user.email ?? "Admin"} />;
}
