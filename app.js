// ============================================================
// Diário de Calls - Etapa 2: calls (participantes, jogos, momentos)
// ============================================================

const auth = firebase.auth();
const db = firebase.firestore();

const $ = (id) => document.getElementById(id);

// Evita que textos digitados quebrem o HTML
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
  avisoTimer = setTimeout(() => (el.hidden = true), 4000);
}

// Erro com mensagem pensada para o usuário
function falha(msg) {
  const e = new Error(msg);
  e.usuario = true;
  return e;
}

function traduzErro(e) {
  if (e && e.usuario) return e.message;
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
  return mapa[e && e.code] || "Algo deu errado. Tente de novo.";
}

// ============================================================
// FORMATAÇÃO DE DATAS E DURAÇÕES
// ============================================================
function novoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const fmtHora = (ms) =>
  new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const fmtDataCurta = (ms) =>
  new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

const fmtDataLonga = (ms) =>
  new Date(ms).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

function fmtDur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, "0")}min` : `${r}min`;
}

function mesmoDia(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Mostra só a hora se for no mesmo dia da referência; senão inclui a data
function fmtQuando(ms, ref) {
  return mesmoDia(ms, ref) ? fmtHora(ms) : `${fmtDataCurta(ms)} ${fmtHora(ms)}`;
}

function paraInput(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============================================================
// LOGIN / CADASTRO
// ============================================================
let modoCriar = false;
let criandoConta = false;

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
      criandoConta = true; // evita que o perfil seja criado duas vezes com nomes diferentes
      const cred = await auth.createUserWithEmailAndPassword(email, senha);
      await cred.user.updateProfile({ displayName: nome });
      await db.collection("users").doc(cred.user.uid).set({
        nome,
        email,
        emailLower: email.toLowerCase(),
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
      cachePerfis[cred.user.uid] = { nome, email };
      usuarioNome = nome;
      $("nome-usuario").textContent = nome;
      criandoConta = false;
      renderGrupoAtual();
    } else {
      await auth.signInWithEmailAndPassword(email, senha);
    }
  } catch (e) {
    criandoConta = false;
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
let usuario = null;
let usuarioNome = "";
let grupos = [];
let grupoAtualId = null;
let abaGrupo = "calls"; // "calls" ou "membros"
let callAtualId = null;
let calls = [];
let cancelaGrupos = null;
let cancelaCalls = null;
let tokenRender = 0;
const cachePerfis = {}; // uid -> { nome, email }

// Se algo falhar ao iniciar, mostra o motivo na tela em vez de deixá-la vazia
function mostraFalha(msg) {
  const el = $("carregando");
  if (el && !el.hidden) el.textContent = msg;
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
    if (cancelaCalls) cancelaCalls();
    cancelaGrupos = null;
    cancelaCalls = null;
    grupos = [];
    calls = [];
    grupoAtualId = null;
    callAtualId = null;
    $("tela-app").hidden = true;
    $("tela-auth").hidden = false;
    return;
  }

  $("tela-auth").hidden = true;
  $("tela-app").hidden = false;

  usuarioNome = u.displayName || u.email;
  $("nome-usuario").textContent = usuarioNome;

  if (!criandoConta) {
    try {
      const ref = db.collection("users").doc(u.uid);
      const snap = await ref.get();
      if (snap.exists) {
        cachePerfis[u.uid] = snap.data();
        if (snap.data().nome) {
          usuarioNome = snap.data().nome;
          $("nome-usuario").textContent = usuarioNome;
        }
      } else {
        const perfil = {
          nome: usuarioNome,
          email: u.email,
          emailLower: (u.email || "").toLowerCase(),
          criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        };
        await ref.set(perfil);
        cachePerfis[u.uid] = { nome: perfil.nome, email: perfil.email };
      }
    } catch (e) {
      console.error(e);
    }
  }

  ouvirGrupos();
});

// ============================================================
// GRUPOS (lista lateral)
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
          selecionarGrupo(null);
          return;
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
      if (g.id !== grupoAtualId) selecionarGrupo(g.id);
      if (window.innerWidth <= 760) {
        $("conteudo").scrollIntoView({ behavior: "smooth" });
      }
    };
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// Troca o grupo aberto e passa a ouvir as calls dele
function selecionarGrupo(id) {
  if (cancelaCalls) {
    cancelaCalls();
    cancelaCalls = null;
  }
  grupoAtualId = id;
  callAtualId = null;
  abaGrupo = "calls";
  calls = [];
  renderGrupos();
  renderGrupoAtual();

  if (!id) return;

  cancelaCalls = db
    .collection("groups")
    .doc(id)
    .collection("calls")
    .orderBy("inicio", "desc")
    .onSnapshot(
      (snap) => {
        calls = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderGrupoAtual();
      },
      (e) => aviso(traduzErro(e))
    );
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
    aviso("Grupo criado.");
    // o snapshot dos grupos ainda pode não ter chegado; aguardamos ele aparecer
    const espera = setInterval(() => {
      if (grupos.some((g) => g.id === ref.id)) {
        clearInterval(espera);
        selecionarGrupo(ref.id);
      }
    }, 100);
    setTimeout(() => clearInterval(espera), 5000);
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
// PERFIS
// ============================================================
async function carregaPerfis(uids) {
  const faltando = uids.filter((uid) => !cachePerfis[uid]);
  await Promise.all(
    faltando.map(async (uid) => {
      try {
        const snap = await db.collection("users").doc(uid).get();
        cachePerfis[uid] = snap.exists ? snap.data() : { nome: "Usuário", email: "" };
      } catch (e) {
        cachePerfis[uid] = { nome: "Usuário", email: "" };
      }
    })
  );
}

function nomeDe(uid) {
  if (cachePerfis[uid] && cachePerfis[uid].nome) return cachePerfis[uid].nome;
  if (usuario && uid === usuario.uid) return usuarioNome;
  return "Usuário";
}

// ============================================================
// RENDERIZAÇÃO DA ÁREA PRINCIPAL
// ============================================================
const IDS_RASCUNHO = ["novo-momento", "novo-jogo", "call-titulo", "sel-membro", "add-email"];

// Guarda o que a pessoa estava digitando, para não perder quando outro amigo editar a call
function guardaRascunho() {
  const r = {};
  IDS_RASCUNHO.forEach((id) => {
    const el = $(id);
    if (el) r[id] = el.value;
  });
  const a = document.activeElement;
  r._foco = a && a.id ? a.id : null;
  return r;
}

function restauraRascunho(r) {
  IDS_RASCUNHO.forEach((id) => {
    const el = $(id);
    if (!el || r[id] === undefined || r[id] === "") return;
    if (id === "call-titulo" && r._foco !== id) return;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === r[id])) return;
    el.value = r[id];
  });
  if (r._foco) {
    const el = $(r._foco);
    if (el) el.focus();
  }
}

function callAtual() {
  return calls.find((c) => c.id === callAtualId);
}

function tituloCall(c) {
  return c.titulo || "Call de " + fmtDataLonga(c.inicio);
}

async function renderGrupoAtual() {
  const meu = ++tokenRender;
  const area = $("conteudo");
  const grupo = grupos.find((g) => g.id === grupoAtualId);

  if (!grupo) {
    area.innerHTML = '<p class="vazio">Escolha um grupo para ver as calls.</p>';
    return;
  }

  await carregaPerfis(grupo.memberIds);
  if (meu !== tokenRender) return; // chegou uma atualização mais nova

  let html = "";
  if (callAtualId) {
    const c = callAtual();
    if (c) html = htmlCall(grupo, c);
    else callAtualId = null;
  }
  if (!html) html = htmlGrupo(grupo);

  const rascunho = guardaRascunho();
  const y = window.scrollY;
  area.innerHTML = html;
  restauraRascunho(rascunho);
  window.scrollTo(0, y);
}

// ---------- Tela do grupo (abas Calls e Membros) ----------
function htmlGrupo(grupo) {
  const aba = (id, texto) =>
    `<button class="aba-g ${abaGrupo === id ? "ativa" : ""}" data-acao="aba" data-aba="${id}" type="button">${texto}</button>`;

  return `
    <h2>${esc(grupo.nome)}</h2>
    <div class="abas-grupo">
      ${aba("calls", "Calls")}
      ${aba("membros", "Membros")}
      <span class="aba-g desativada">Estatísticas (em breve)</span>
    </div>
    ${abaGrupo === "calls" ? htmlListaCalls() : htmlMembros(grupo)}
  `;
}

function htmlListaCalls() {
  const emAndamento = calls.find((c) => c.fim == null);
  const botao = emAndamento
    ? `<button class="btn-principal" data-acao="abrir-call" data-id="${esc(emAndamento.id)}" type="button">Abrir a call em andamento</button>`
    : `<button class="btn-principal" data-acao="iniciar-call" type="button">Iniciar call</button>`;

  if (calls.length === 0) {
    return `
      <div class="acoes-topo">${botao}</div>
      <p class="vazio">Nenhuma call registrada ainda. Quando começarem a conversar no Discord, toque em "Iniciar call".</p>`;
  }

  const cards = calls
    .map((c) => {
      const dur = (c.fim == null ? Date.now() : c.fim) - c.inicio;
      const nomes = [...new Set((c.participantes || []).map((p) => p.nome))];
      const jogos = [...new Set((c.jogos || []).map((j) => j.nome))];
      const nMom = (c.momentos || []).length;
      const horario =
        c.fim == null
          ? `Começou às ${fmtHora(c.inicio)}`
          : `${fmtHora(c.inicio)} às ${fmtQuando(c.fim, c.inicio)} (${fmtDur(dur)})`;
      return `
        <li>
          <button class="card-call" data-acao="abrir-call" data-id="${esc(c.id)}" type="button">
            <span class="card-topo">
              <strong>${esc(tituloCall(c))}</strong>
              ${c.fim == null ? '<span class="selo">Em andamento</span>' : ""}
            </span>
            <span class="suave">${esc(horario)}</span>
            ${nomes.length ? `<span class="suave">Com ${esc(nomes.join(", "))}</span>` : ""}
            ${jogos.length ? `<span class="suave">Jogos: ${esc(jogos.join(", "))}</span>` : ""}
            ${nMom ? `<span class="suave">${nMom} ${nMom === 1 ? "momento anotado" : "momentos anotados"}</span>` : ""}
          </button>
        </li>`;
    })
    .join("");

  return `
    <div class="acoes-topo">${botao}</div>
    <ul class="lista-calls">${cards}</ul>`;
}

// ---------- Aba Membros ----------
function htmlMembros(grupo) {
  const souDono = grupo.ownerId === usuario.uid;

  const itens = grupo.memberIds
    .map((uid) => {
      const p = cachePerfis[uid] || { nome: "Usuário", email: "" };
      const ehDono = uid === grupo.ownerId;
      let acao = "";
      if (souDono && uid !== usuario.uid) {
        acao = `<button class="btn-sec btn-perigo" data-acao="remover-membro" data-id="${esc(uid)}" type="button">Remover</button>`;
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

  return `
    <p class="vazio">${grupo.memberIds.length} ${grupo.memberIds.length === 1 ? "membro" : "membros"}</p>
    <ul class="membros">${itens}</ul>

    ${
      souDono
        ? `<h3>Adicionar pessoa</h3>
           <div class="add-membro">
             <input id="add-email" type="email" placeholder="E-mail da conta do seu amigo">
             <button class="btn-principal" data-acao="add-membro" type="button">Adicionar</button>
           </div>
           <p class="vazio">Seu amigo precisa criar uma conta no site antes de ser adicionado.</p>`
        : `<h3>Sair do grupo</h3>
           <button class="btn-sec btn-perigo" data-acao="sair-grupo" type="button">Sair deste grupo</button>`
    }
  `;
}

// ---------- Tela da call ----------
function nomesDeJogosConhecidos() {
  const vistos = new Map();
  calls.forEach((c) =>
    (c.jogos || []).forEach((j) => {
      const chave = j.nome.trim().toLowerCase();
      if (!vistos.has(chave)) vistos.set(chave, j.nome);
    })
  );
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function htmlCall(grupo, c) {
  const agora = Date.now();
  const encerrada = c.fim != null;
  const total = (encerrada ? c.fim : agora) - c.inicio;

  const sess = (c.participantes || []).slice().sort((a, b) => a.entrou - b.entrou);
  const jogos = (c.jogos || []).slice().sort((a, b) => a.inicio - b.inicio);
  const momentos = (c.momentos || []).slice().sort((a, b) => a.quando - b.quando);

  const dentro = new Set(sess.filter((s) => s.saiu == null).map((s) => s.uid));
  const opcoes = grupo.memberIds
    .filter((uid) => !dentro.has(uid))
    .map((uid) => `<option value="${esc(uid)}">${esc(nomeDe(uid))}</option>`)
    .join("");

  const hora = (acao, id, ms) =>
    `<button class="hora" data-acao="${acao}" ${id ? `data-id="${esc(id)}"` : ""} type="button">${fmtQuando(ms, c.inicio)}</button>`;

  // Participantes
  const linhasSess = sess
    .map((s) => {
      const dur = (s.saiu == null ? agora : s.saiu) - s.entrou;
      return `
      <li class="linha">
        <div class="linha-nome">${esc(s.nome)}</div>
        <div class="linha-info">
          ${hora("ed-entrou", s.id, s.entrou)} até
          ${s.saiu == null ? '<span class="selo">na call</span>' : hora("ed-saiu", s.id, s.saiu)}
          <span class="suave">(<span ${s.saiu == null ? `data-vivo="${s.entrou}"` : ""}>${fmtDur(dur)}</span>)</span>
        </div>
        <div class="linha-acoes">
          ${s.saiu == null ? `<button class="btn-sec" data-acao="saiu" data-id="${esc(s.id)}" type="button">Saiu agora</button>` : ""}
          <button class="btn-sec btn-icone" data-acao="del-sessao" data-id="${esc(s.id)}" title="Remover registro" aria-label="Remover registro" type="button">×</button>
        </div>
      </li>`;
    })
    .join("");

  let addPessoa = "";
  if (encerrada) {
    addPessoa = '<p class="vazio">Reabra a call para registrar novas entradas.</p>';
  } else if (opcoes) {
    addPessoa = `
      <div class="add-linha">
        <select id="sel-membro">${opcoes}</select>
        <button class="btn-principal" data-acao="entrou" type="button">Entrou agora</button>
      </div>`;
  } else {
    addPessoa = '<p class="vazio">Todo mundo do grupo já está na call.</p>';
  }

  // Jogos
  const linhasJogos = jogos
    .map((j) => {
      const dur = (j.fim == null ? agora : j.fim) - j.inicio;
      return `
      <li class="linha">
        <div class="linha-nome">${esc(j.nome)}</div>
        <div class="linha-info">
          ${hora("ed-jogo-ini", j.id, j.inicio)} até
          ${j.fim == null ? '<span class="selo">jogando</span>' : hora("ed-jogo-fim", j.id, j.fim)}
          <span class="suave">(<span ${j.fim == null ? `data-vivo="${j.inicio}"` : ""}>${fmtDur(dur)}</span>)</span>
        </div>
        <div class="linha-acoes">
          ${j.fim == null ? `<button class="btn-sec" data-acao="jogo-parou" data-id="${esc(j.id)}" type="button">Parou</button>` : ""}
          <button class="btn-sec btn-icone" data-acao="del-jogo" data-id="${esc(j.id)}" title="Remover jogo" aria-label="Remover jogo" type="button">×</button>
        </div>
      </li>`;
    })
    .join("");

  const sugestoes = nomesDeJogosConhecidos()
    .map((n) => `<option value="${esc(n)}"></option>`)
    .join("");

  const addJogo = encerrada
    ? '<p class="vazio">Reabra a call para registrar novos jogos.</p>'
    : `
      <div class="add-linha">
        <input id="novo-jogo" list="lista-jogos" maxlength="40" placeholder="Nome do jogo" autocomplete="off">
        <datalist id="lista-jogos">${sugestoes}</datalist>
        <button class="btn-principal" data-acao="jogo-add" type="button">Começou a jogar</button>
      </div>`;

  // Momentos
  const linhasMomentos = momentos
    .map(
      (m) => `
      <li class="momento">
        <div class="momento-meta">
          <strong>${esc(m.autorNome)}</strong>
          <span class="suave">${fmtQuando(m.quando, c.inicio)}</span>
          ${
            m.autorId === usuario.uid
              ? `<button class="btn-sec btn-icone" data-acao="del-momento" data-id="${esc(m.id)}" title="Apagar anotação" aria-label="Apagar anotação" type="button">×</button>`
              : ""
          }
        </div>
        <p>${esc(m.texto)}</p>
      </li>`
    )
    .join("");

  return `
    <button class="voltar" data-acao="voltar" type="button">‹ Voltar às calls</button>

    <input id="call-titulo" class="titulo-call" maxlength="60"
           value="${esc(c.titulo || "")}" placeholder="${esc("Call de " + fmtDataLonga(c.inicio))}"
           aria-label="Título da call">

    <div class="resumo-call">
      <div>Início ${hora("ed-inicio", "", c.inicio)}</div>
      <div>Fim ${encerrada ? hora("ed-fim", "", c.fim) : '<span class="selo">em andamento</span>'}</div>
      <div>Duração <strong ${encerrada ? "" : `data-vivo="${c.inicio}"`}>${fmtDur(total)}</strong></div>
    </div>

    <div class="acoes-call">
      ${
        encerrada
          ? '<button class="btn-sec" data-acao="reabrir" type="button">Reabrir call</button>'
          : '<button class="btn-principal" data-acao="encerrar" type="button">Encerrar call</button>'
      }
      <button class="btn-sec btn-perigo" data-acao="excluir-call" type="button">Excluir call</button>
    </div>

    <h3>Participantes</h3>
    ${linhasSess ? `<ul class="linhas">${linhasSess}</ul>` : '<p class="vazio">Ninguém registrado ainda.</p>'}
    ${addPessoa}

    <h3>Jogos</h3>
    ${linhasJogos ? `<ul class="linhas">${linhasJogos}</ul>` : '<p class="vazio">Nenhum jogo ainda. Se estiverem só conversando, não precisa adicionar nada.</p>'}
    ${addJogo}

    <h3>Momentos</h3>
    ${linhasMomentos ? `<ul class="momentos">${linhasMomentos}</ul>` : '<p class="vazio">Nada anotado ainda. Frases engraçadas e acontecimentos vão aqui.</p>'}
    <div class="add-momento">
      <textarea id="novo-momento" rows="2" maxlength="600" placeholder="Anote uma frase ou um acontecimento (Ctrl+Enter para enviar)"></textarea>
      <button class="btn-principal" data-acao="momento-add" type="button">Anotar</button>
    </div>
  `;
}

// ============================================================
// EDIÇÃO DA CALL (transação: vários amigos podem editar ao mesmo tempo)
// ============================================================
function callsRef() {
  return db.collection("groups").doc(grupoAtualId).collection("calls");
}

function editaCall(callId, fn) {
  const ref = callsRef().doc(callId);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw falha("Essa call não existe mais.");
    const c = snap.data();
    c.participantes = c.participantes || [];
    c.jogos = c.jogos || [];
    c.momentos = c.momentos || [];
    fn(c);
    t.update(ref, {
      titulo: c.titulo || "",
      inicio: c.inicio,
      fim: c.fim == null ? null : c.fim,
      participantes: c.participantes,
      jogos: c.jogos,
      momentos: c.momentos
    });
  });
}

async function tenta(promessa) {
  try {
    await promessa;
  } catch (e) {
    console.error(e);
    aviso(traduzErro(e));
  }
}

// ---------- Diálogo para escolher horário ----------
function pedeHorario(titulo, ms, podeLimpar) {
  return new Promise((resolve) => {
    const dlg = $("dlg-hora");
    let resultado;
    $("dlg-titulo").textContent = titulo;
    $("dlg-input").value = ms ? paraInput(ms) : "";
    $("dlg-limpar").hidden = !podeLimpar;
    $("dlg-ok").onclick = () => {
      const v = $("dlg-input").value;
      if (!v) return;
      resultado = { valor: new Date(v).getTime() };
      dlg.close();
    };
    $("dlg-limpar").onclick = () => {
      resultado = { valor: null };
      dlg.close();
    };
    $("dlg-cancelar").onclick = () => dlg.close();
    dlg.onclose = () => resolve(resultado);
    dlg.showModal();
  });
}

async function editaHora(titulo, atual, podeLimpar, aplica) {
  const r = await pedeHorario(titulo, atual, podeLimpar);
  if (r === undefined) return;
  await tenta(editaCall(callAtualId, (c) => aplica(c, r.valor)));
}

const achaItem = (lista, id) => {
  const item = lista.find((x) => x.id === id);
  if (!item) throw falha("Esse registro não existe mais.");
  return item;
};

// ---------- Ações da call ----------
async function iniciarCall() {
  const agora = Date.now();
  try {
    const ref = await callsRef().add({
      titulo: "",
      inicio: agora,
      fim: null,
      criadoPor: usuario.uid,
      participantes: [
        { id: novoId(), uid: usuario.uid, nome: nomeDe(usuario.uid), entrou: agora, saiu: null }
      ],
      jogos: [],
      momentos: []
    });
    callAtualId = ref.id;
    renderGrupoAtual();
    window.scrollTo(0, 0);
  } catch (e) {
    aviso(traduzErro(e));
  }
}

function encerrarCall() {
  if (!confirm("Encerrar a call agora? Quem ainda estiver nela e o jogo atual serão encerrados junto.")) return;
  tenta(
    editaCall(callAtualId, (c) => {
      const t = Date.now();
      c.fim = t;
      c.participantes.forEach((p) => {
        if (p.saiu == null) p.saiu = t;
      });
      c.jogos.forEach((j) => {
        if (j.fim == null) j.fim = t;
      });
    })
  );
}

function reabrirCall() {
  tenta(
    editaCall(callAtualId, (c) => {
      c.fim = null;
    })
  );
}

async function excluirCall() {
  if (!confirm("Excluir esta call de vez? Isso apaga participantes, jogos e momentos e não dá para desfazer.")) return;
  try {
    await callsRef().doc(callAtualId).delete();
    callAtualId = null;
    renderGrupoAtual();
    aviso("Call excluída.");
  } catch (e) {
    aviso(traduzErro(e));
  }
}

function pessoaEntrou() {
  const sel = $("sel-membro");
  const uid = sel && sel.value;
  if (!uid) return;
  tenta(
    editaCall(callAtualId, (c) => {
      if (c.fim != null) throw falha("A call já foi encerrada. Reabra para registrar entradas.");
      if (c.participantes.some((p) => p.uid === uid && p.saiu == null)) return;
      c.participantes.push({ id: novoId(), uid, nome: nomeDe(uid), entrou: Date.now(), saiu: null });
    })
  );
}

function pessoaSaiu(id) {
  tenta(
    editaCall(callAtualId, (c) => {
      const s = achaItem(c.participantes, id);
      if (s.saiu == null) s.saiu = Date.now();
    })
  );
}

function adicionarJogo() {
  const input = $("novo-jogo");
  const nome = input.value.trim().slice(0, 40);
  if (!nome) {
    aviso("Digite o nome do jogo.");
    return;
  }
  input.value = "";
  tenta(
    editaCall(callAtualId, (c) => {
      if (c.fim != null) throw falha("A call já foi encerrada. Reabra para registrar jogos.");
      const t = Date.now();
      c.jogos.forEach((j) => {
        if (j.fim == null) j.fim = t;
      });
      c.jogos.push({ id: novoId(), nome, inicio: t, fim: null });
    })
  );
}

function jogoParou(id) {
  tenta(
    editaCall(callAtualId, (c) => {
      const j = achaItem(c.jogos, id);
      if (j.fim == null) j.fim = Date.now();
    })
  );
}

function adicionarMomento() {
  const campo = $("novo-momento");
  const texto = campo.value.trim().slice(0, 600);
  if (!texto) {
    aviso("Escreva a anotação antes de enviar.");
    return;
  }
  campo.value = "";
  tenta(
    editaCall(callAtualId, (c) => {
      c.momentos.push({
        id: novoId(),
        texto,
        autorId: usuario.uid,
        autorNome: nomeDe(usuario.uid),
        quando: Date.now()
      });
    })
  );
}

function removerDaLista(campo, id) {
  tenta(
    editaCall(callAtualId, (c) => {
      c[campo] = c[campo].filter((x) => x.id !== id);
    })
  );
}

// ---------- Edição de horários ----------
function editarInicio() {
  const c = callAtual();
  editaHora("Horário de início da call", c.inicio, false, (c2, v) => {
    if (c2.fim != null && v >= c2.fim) throw falha("O início precisa ser antes do fim.");
    c2.inicio = v;
  });
}

function editarFim() {
  const c = callAtual();
  editaHora("Horário de fim da call", c.fim, true, (c2, v) => {
    if (v === null) {
      c2.fim = null;
      return;
    }
    if (v <= c2.inicio) throw falha("O fim precisa ser depois do início.");
    c2.fim = v;
  });
}

function editarHoraItem(campoLista, id, campoHora, titulo, ehFim) {
  const c = callAtual();
  const item = (c[campoLista] || []).find((x) => x.id === id);
  if (!item) return;
  const inicioKey = campoLista === "participantes" ? "entrou" : "inicio";
  const fimKey = campoLista === "participantes" ? "saiu" : "fim";
  editaHora(titulo, item[campoHora], false, (c2, v) => {
    const it = achaItem(c2[campoLista], id);
    if (ehFim && v <= it[inicioKey]) throw falha("A saída precisa ser depois da entrada.");
    if (!ehFim && it[fimKey] != null && v >= it[fimKey]) throw falha("O início precisa ser antes do fim.");
    it[campoHora] = v;
  });
}

// ---------- Membros do grupo ----------
async function adicionarMembro(grupo) {
  const input = $("add-email");
  const email = input.value.trim().toLowerCase();
  if (!email) {
    aviso("Digite o e-mail da pessoa.");
    return;
  }
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
  }
}

async function removerMembro(grupo, uid) {
  if (!confirm(`Remover ${nomeDe(uid)} do grupo?`)) return;
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
    aviso("Você saiu do grupo.");
  } catch (e) {
    aviso(traduzErro(e));
  }
}

// ============================================================
// EVENTOS DA ÁREA PRINCIPAL (um só ouvinte para tudo)
// ============================================================
$("conteudo").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-acao]");
  if (!b) return;
  const id = b.dataset.id;
  const grupo = grupos.find((g) => g.id === grupoAtualId);

  switch (b.dataset.acao) {
    case "aba":
      abaGrupo = b.dataset.aba;
      renderGrupoAtual();
      break;
    case "abrir-call":
      callAtualId = id;
      renderGrupoAtual();
      window.scrollTo(0, 0);
      break;
    case "voltar":
      callAtualId = null;
      renderGrupoAtual();
      break;
    case "iniciar-call": iniciarCall(); break;
    case "encerrar": encerrarCall(); break;
    case "reabrir": reabrirCall(); break;
    case "excluir-call": excluirCall(); break;

    case "entrou": pessoaEntrou(); break;
    case "saiu": pessoaSaiu(id); break;
    case "del-sessao": removerDaLista("participantes", id); break;

    case "jogo-add": adicionarJogo(); break;
    case "jogo-parou": jogoParou(id); break;
    case "del-jogo": removerDaLista("jogos", id); break;

    case "momento-add": adicionarMomento(); break;
    case "del-momento": removerDaLista("momentos", id); break;

    case "ed-inicio": editarInicio(); break;
    case "ed-fim": editarFim(); break;
    case "ed-entrou": editarHoraItem("participantes", id, "entrou", "Horário em que entrou", false); break;
    case "ed-saiu": editarHoraItem("participantes", id, "saiu", "Horário em que saiu", true); break;
    case "ed-jogo-ini": editarHoraItem("jogos", id, "inicio", "Horário em que começou o jogo", false); break;
    case "ed-jogo-fim": editarHoraItem("jogos", id, "fim", "Horário em que parou o jogo", true); break;

    case "add-membro": if (grupo) adicionarMembro(grupo); break;
    case "remover-membro": if (grupo) removerMembro(grupo, id); break;
    case "sair-grupo": if (grupo) sairDoGrupo(grupo); break;
  }
});

$("conteudo").addEventListener("keydown", (ev) => {
  const alvo = ev.target.id;
  if (ev.key !== "Enter") return;
  if (alvo === "novo-jogo") {
    ev.preventDefault();
    adicionarJogo();
  } else if (alvo === "novo-momento" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    adicionarMomento();
  } else if (alvo === "add-email") {
    const grupo = grupos.find((g) => g.id === grupoAtualId);
    if (grupo) adicionarMembro(grupo);
  } else if (alvo === "call-titulo") {
    ev.target.blur();
  }
});

$("conteudo").addEventListener("change", (ev) => {
  if (ev.target.id === "call-titulo") {
    const titulo = ev.target.value.trim().slice(0, 60);
    tenta(
      editaCall(callAtualId, (c) => {
        c.titulo = titulo;
      })
    );
  }
});

// Atualiza as durações "ao vivo" a cada 30 segundos sem redesenhar a tela
setInterval(() => {
  document.querySelectorAll("[data-vivo]").forEach((el) => {
    el.textContent = fmtDur(Date.now() - Number(el.dataset.vivo));
  });
}, 30000);
