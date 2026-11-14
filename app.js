// ============================================================
// Diário de Calls - Etapa 1: login, grupos e membros
// ============================================================

const auth = firebase.auth();
const db = firebase.firestore();

// ---------- Atalhos ----------
const $ = (id) => document.getElementById(id);

// Evita que nomes digitados quebrem o HTML
function esc(texto) {
  const d = document.createElement("div");
  d.textContent = texto == null ? "" : String(texto);
  return d.innerHTML;
}

let avisoTimer = null;
function aviso(msg) {
  const el = $("aviso");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), 3500);
}

function traduzErro(e) {
  const mapa = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/missing-password": "Digite a senha.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Espere um pouco e tente de novo.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "permission-denied": "Você não tem permissão para fazer isso."
  };
  return mapa[e.code] || "Algo deu errado. Tente de novo.";
}

// ============================================================
// LOGIN / CADASTRO
// ============================================================
let modoCriar = false;

function trocarModo(criar) {
  modoCriar = criar;
  $("aba-entrar").classList.toggle("ativa", !criar);
  $("aba-criar").classList.toggle("ativa", criar);
  $("campo-nome").hidden = !criar;
  $("btn-auth").textContent = criar ? "Criar conta" : "Entrar";
  $("auth-senha").autocomplete = criar ? "new-password" : "current-password";
  $("auth-erro").textContent = "";
}

$("aba-entrar").onclick = () => trocarModo(false);
$("aba-criar").onclick = () => trocarModo(true);

async function enviarAuth() {
  const email = $("auth-email").value.trim();
  const senha = $("auth-senha").value;
  const nome = $("auth-nome").value.trim();
  const btn = $("btn-auth");
  $("auth-erro").textContent = "";

  if (modoCriar && !nome) {
    $("auth-erro").textContent = "Digite seu nome.";
    return;
  }

  btn.disabled = true;
  try {
    if (modoCriar) {
      const cred = await auth.createUserWithEmailAndPassword(email, senha);
      await cred.user.updateProfile({ displayName: nome });
      await db.collection("users").doc(cred.user.uid).set({
        nome,
        email,
        emailLower: email.toLowerCase(),
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
      // O onAuthStateChanged já mostra o app; recarregamos o nome salvo
      usuarioNome = nome;
      $("nome-usuario").textContent = nome;
    } else {
      await auth.signInWithEmailAndPassword(email, senha);
    }
  } catch (e) {
    $("auth-erro").textContent = traduzErro(e);
  } finally {
    btn.disabled = false;
  }
}

$("btn-auth").onclick = enviarAuth;
["auth-nome", "auth-email", "auth-senha"].forEach((id) =>
  $(id).addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") enviarAuth();
  })
);

$("btn-esqueci").onclick = async () => {
  const email = $("auth-email").value.trim();
  if (!email) {
    $("auth-erro").textContent = "Digite seu e-mail acima para receber o link.";
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
    $("auth-erro").textContent = "";
    aviso("Enviamos um link de redefinição para o seu e-mail.");
  } catch (e) {
    $("auth-erro").textContent = traduzErro(e);
  }
};

$("btn-sair").onclick = () => auth.signOut();

// ============================================================
// ESTADO DO APP
// ============================================================
let usuario = null;         // usuário do Firebase Auth
let usuarioNome = "";
let grupos = [];            // grupos em que o usuário está
let grupoAtualId = null;
let cancelaGrupos = null;   // função para parar de ouvir os grupos
const cachePerfis = {};     // uid -> {nome, email}

// Se algo falhar ao iniciar, mostra o motivo na tela em vez de deixá-la vazia
function mostraFalha(msg) {
  const el = $("carregando");
  if (el && !el.hidden) {
    el.textContent = msg;
  }
}

window.addEventListener("error", (ev) => {
  mostraFalha("Erro ao iniciar: " + ev.message + " (abra o console com F12 para ver mais detalhes)");
});

setTimeout(() => {
  mostraFalha(
    "Não foi possível conectar ao Firebase. Confira o arquivo firebase-config.js, " +
    "se o domínio está autorizado em Authentication e abra o console (F12) para ver o erro."
  );
}, 8000);

auth.onAuthStateChanged(async (u) => {
  $("carregando").hidden = true;
  usuario = u;

  if (!u) {
    if (cancelaGrupos) cancelaGrupos();
    cancelaGrupos = null;
    grupos = [];
    grupoAtualId = null;
    $("tela-app").hidden = true;
    $("tela-auth").hidden = false;
    return;
  }

  $("tela-auth").hidden = true;
  $("tela-app").hidden = false;

  usuarioNome = u.displayName || u.email;
  $("nome-usuario").textContent = usuarioNome;

  // Garante que o perfil existe (útil para contas antigas)
  try {
    const ref = db.collection("users").doc(u.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        nome: usuarioNome,
        email: u.email,
        emailLower: (u.email || "").toLowerCase(),
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (e) {
    console.error(e);
  }

  ouvirGrupos();
});

// ============================================================
// GRUPOS
// ============================================================
function ouvirGrupos() {
  if (cancelaGrupos) cancelaGrupos();
  cancelaGrupos = db
    .collection("groups")
    .where("memberIds", "array-contains", usuario.uid)
    .onSnapshot(
      (snap) => {
        grupos = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        if (grupoAtualId && !grupos.some((g) => g.id === grupoAtualId)) {
          grupoAtualId = null;
        }
        renderGrupos();
        renderGrupoAtual();
      },
      (e) => aviso(traduzErro(e))
    );
}

function renderGrupos() {
  const ul = $("lista-grupos");
  ul.innerHTML = "";
  $("sem-grupos").hidden = grupos.length > 0;

  grupos.forEach((g) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = g.nome;
    if (g.id === grupoAtualId) btn.classList.add("ativo");
    btn.onclick = () => {
      grupoAtualId = g.id;
      renderGrupos();
      renderGrupoAtual();
    };
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function criarGrupo() {
  const input = $("novo-grupo-nome");
  const nome = input.value.trim();
  if (!nome) {
    aviso("Digite um nome para o grupo.");
    return;
  }
  $("btn-criar-grupo").disabled = true;
  try {
    const ref = await db.collection("groups").add({
      nome,
      ownerId: usuario.uid,
      memberIds: [usuario.uid],
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = "";
    grupoAtualId = ref.id;
    aviso("Grupo criado.");
  } catch (e) {
    aviso(traduzErro(e));
  } finally {
    $("btn-criar-grupo").disabled = false;
  }
}

$("btn-criar-grupo").onclick = criarGrupo;
$("novo-grupo-nome").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") criarGrupo();
});

// ============================================================
// DETALHE DO GRUPO (membros)
// ============================================================
async function carregaPerfis(uids) {
  const faltando = uids.filter((uid) => !cachePerfis[uid]);
  await Promise.all(
    faltando.map(async (uid) => {
      try {
        const snap = await db.collection("users").doc(uid).get();
        cachePerfis[uid] = snap.exists
          ? snap.data()
          : { nome: "Usuário", email: "" };
      } catch (e) {
        cachePerfis[uid] = { nome: "Usuário", email: "" };
      }
    })
  );
}

async function renderGrupoAtual() {
  const area = $("conteudo");
  const grupo = grupos.find((g) => g.id === grupoAtualId);

  if (!grupo) {
    area.innerHTML = '<p class="vazio">Escolha um grupo para ver os membros.</p>';
    return;
  }

  await carregaPerfis(grupo.memberIds);
  // O grupo pode ter mudado enquanto carregava os perfis
  if (grupoAtualId !== grupo.id) return;

  const souDono = grupo.ownerId === usuario.uid;

  const itens = grupo.memberIds
    .map((uid) => {
      const p = cachePerfis[uid];
      const ehDono = uid === grupo.ownerId;
      let acao = "";
      if (souDono && uid !== usuario.uid) {
        acao = `<button class="btn-sec btn-perigo" data-remover="${esc(uid)}" type="button">Remover</button>`;
      }
      return `
        <li class="membro">
          <div class="info">
            <div>${esc(p.nome)}${uid === usuario.uid ? " (você)" : ""}</div>
            <div class="email">${esc(p.email)}</div>
          </div>
          ${ehDono ? '<span class="selo">Dono</span>' : ""}
          ${acao}
        </li>`;
    })
    .join("");

  area.innerHTML = `
    <h2>${esc(grupo.nome)}</h2>
    <p class="vazio">${grupo.memberIds.length} ${grupo.memberIds.length === 1 ? "membro" : "membros"}</p>

    <h3>Membros</h3>
    <ul class="membros">${itens}</ul>

    ${
      souDono
        ? `<h3>Adicionar pessoa</h3>
           <div class="add-membro">
             <input id="add-email" type="email" placeholder="E-mail da conta do seu amigo">
             <button id="btn-add" class="btn-principal" type="button">Adicionar</button>
           </div>
           <p class="vazio">Seu amigo precisa criar uma conta no site antes de ser adicionado.</p>`
        : `<h3>Sair do grupo</h3>
           <button id="btn-sair-grupo" class="btn-sec btn-perigo" type="button">Sair deste grupo</button>`
    }

    <div class="nota">As calls deste grupo aparecem aqui na próxima etapa.</div>
  `;

  area.querySelectorAll("[data-remover]").forEach((b) => {
    b.onclick = () => removerMembro(grupo, b.dataset.remover);
  });

  if (souDono) {
    $("btn-add").onclick = () => adicionarMembro(grupo);
    $("add-email").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") adicionarMembro(grupo);
    });
  } else {
    $("btn-sair-grupo").onclick = () => sairDoGrupo(grupo);
  }
}

async function adicionarMembro(grupo) {
  const input = $("add-email");
  const email = input.value.trim().toLowerCase();
  if (!email) {
    aviso("Digite o e-mail da pessoa.");
    return;
  }
  $("btn-add").disabled = true;
  try {
    const res = await db
      .collection("users")
      .where("emailLower", "==", email)
      .limit(1)
      .get();

    if (res.empty) {
      aviso("Nenhuma conta encontrada com esse e-mail. Peça para a pessoa criar a conta primeiro.");
      return;
    }

    const uid = res.docs[0].id;
    if (grupo.memberIds.includes(uid)) {
      aviso("Essa pessoa já está no grupo.");
      return;
    }

    cachePerfis[uid] = res.docs[0].data();
    await db
      .collection("groups")
      .doc(grupo.id)
      .update({ memberIds: firebase.firestore.FieldValue.arrayUnion(uid) });
    input.value = "";
    aviso(`${cachePerfis[uid].nome} foi adicionado(a) ao grupo.`);
  } catch (e) {
    aviso(traduzErro(e));
  } finally {
    const b = $("btn-add");
    if (b) b.disabled = false;
  }
}

async function removerMembro(grupo, uid) {
  const nome = (cachePerfis[uid] && cachePerfis[uid].nome) || "essa pessoa";
  if (!confirm(`Remover ${nome} do grupo?`)) return;
  try {
    await db
      .collection("groups")
      .doc(grupo.id)
      .update({ memberIds: firebase.firestore.FieldValue.arrayRemove(uid) });
    aviso("Pessoa removida.");
  } catch (e) {
    aviso(traduzErro(e));
  }
}

async function sairDoGrupo(grupo) {
  if (!confirm(`Sair do grupo "${grupo.nome}"?`)) return;
  try {
    await db
      .collection("groups")
      .doc(grupo.id)
      .update({ memberIds: firebase.firestore.FieldValue.arrayRemove(usuario.uid) });
    grupoAtualId = null;
    aviso("Você saiu do grupo.");
  } catch (e) {
    aviso(traduzErro(e));
  }
}
