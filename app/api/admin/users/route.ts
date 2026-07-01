import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usuarioParaEmail } from "@/lib/auth";

export const runtime = "nodejs";

/** Verifica que el usuario actual sea admin. Devuelve null si no lo es. */
async function exigirAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return perfil?.role === "admin" ? user : null;
}

const SIN_PERMISO = Response.json(
  { error: "Sem permissão." },
  { status: 403 },
);

/** Lista todos los usuarios (conductores y admins). */
export async function GET() {
  if (!(await exigirAdmin())) return SIN_PERMISO;

  const admin = createAdminClient();
  const { data: lista, error } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: perfis } = await admin
    .from("profiles")
    .select("id, role, nome");
  const mapa = new Map(
    (perfis ?? []).map((p) => [p.id, { role: p.role, nome: p.nome }]),
  );

  const usuarios = lista.users.map((u) => ({
    id: u.id,
    email: u.email ?? "",
    nome: mapa.get(u.id)?.nome ?? (u.user_metadata?.nome as string) ?? "",
    role: mapa.get(u.id)?.role ?? "conductor",
    criado_em: u.created_at,
  }));

  return Response.json({ usuarios });
}

/** Crea un nuevo usuario (conductor o admin). */
export async function POST(req: Request) {
  if (!(await exigirAdmin())) return SIN_PERMISO;

  const { usuario, nome, senha, role } = await req.json().catch(() => ({}));
  if (!usuario || !nome || !senha) {
    return Response.json(
      { error: "Faltam dados (nome, usuário, senha)." },
      { status: 400 },
    );
  }
  if (String(senha).length < 6) {
    return Response.json(
      { error: "A senha deve ter pelo menos 6 caracteres." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: usuarioParaEmail(String(usuario)),
    password: String(senha),
    email_confirm: true,
    user_metadata: { nome: String(nome).trim() },
  });
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  // El trigger crea el perfil como 'conductor'. Si se pidió otro rol, lo actualizamos.
  if ((role === "admin" || role === "supervisor") && data.user) {
    await admin.from("profiles").update({ role }).eq("id", data.user.id);
  }

  return Response.json({ ok: true });
}

/** Actualiza un usuario: resetear contraseña o cambiar rol. */
export async function PATCH(req: Request) {
  if (!(await exigirAdmin())) return SIN_PERMISO;

  const { id, senha, role } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "Falta o id." }, { status: 400 });

  const admin = createAdminClient();

  if (senha) {
    if (String(senha).length < 6) {
      return Response.json(
        { error: "A senha deve ter pelo menos 6 caracteres." },
        { status: 400 },
      );
    }
    const { error } = await admin.auth.admin.updateUserById(id, {
      password: String(senha),
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }

  if (role === "admin" || role === "conductor" || role === "supervisor") {
    await admin.from("profiles").update({ role }).eq("id", id);
  }

  return Response.json({ ok: true });
}
