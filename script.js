/**
 * Projeto: Última Letra.
 * Jogo de forca em português no qual o sistema escolhe uma palavra e o jogador dispõe de seis erros.
 *
 * Arquitetura: WORD_BANK mantém os dados; ScoreStorage isola a persistência; GameRules concentra
 * regras sem conhecer o DOM; o estado da sessão conecta essas camadas; funções de interface renderizam
 * a página; listeners traduzem ações do usuário; e a inicialização restaura preferências e monta controles.
 *
 * Ordem do arquivo: banco e constantes, persistência, regras, referências DOM, estado, renderização,
 * coordenação da partida, criação de controles, eventos e inicialização.
 */
"use strict";

/* ==================== BANCO DE PALAVRAS ==================== */
/**
 * Vocabulário separado da lógica para permitir expansão sem alterar regras.
 * RN06: `facil` aceita 4–5 letras, `medio` 6–8 e `dificil` 9 ou mais.
 * Novos termos devem ser comuns, maiúsculos, sem espaços/hífens ou vogais acentuadas; Ç é permitida.
 */
// Banco de palavras independente das regras: cada lista pode ser ampliada sem mudar o jogo.
const WORD_BANK = Object.freeze({
  // Palavras fáceis têm de 4 a 5 caracteres para reduzir o espaço de busca.
  facil: ["CASA", "LIVRO", "GATO", "RATO", "BOLO", "PATO", "MESA", "VENTO", "NUVEM", "CHUVA", "FOLHA", "PEIXE", "PRAIA", "LAÇO", "POÇO", "FLOR"],
  // Palavras médias têm de 6 a 8 caracteres e equilibram duração e dificuldade.
  medio: ["JANELA", "ESCOLA", "CAMINHO", "ABRAÇO", "CAÇULA", "SAPATO", "CADERNO", "COZINHA", "BRINCO", "CACHORRO", "PLANETA", "AMIGOS", "BANANA", "FORMIGA", "TECLADO", "MORANGO"],
  // Palavras difíceis têm 9 ou mais caracteres, conforme o único critério de dificuldade.
  dificil: ["BORBOLETA", "CHOCOLATE", "BICICLETA", "GELADEIRA", "TARTARUGA", "COMPUTADOR", "BRINCADEIRA", "TRAVESSEIRO", "ESCORREGADOR", "JARDINEIRO", "SUPERMERCADO", "FOTOGRAFIA", "ARQUITETURA", "MARAVILHOSO", "PASSARINHO", "DESCOBERTA", "ASTRONAUTA"]
});

/* ==================== CONFIGURAÇÕES E CONSTANTES ==================== */
// Lista canônica dos níveis válidos; também orienta validação e criação do placar.
const LEVELS = Object.keys(WORD_BANK);
// RN05/RF08: todos os níveis compartilham o limite imutável de seis erros.
const MAX_ERRORS = 6;
// RF04: o teclado virtual oferece A–Z e omite Ç, tratada como C pela normalização.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";


/* ==================== PERSISTÊNCIA (localStorage) ==================== */
/**
 * Camada única de acesso ao localStorage. Ela protege o jogo contra bloqueio de armazenamento,
 * JSON corrompido e formatos inválidos, sempre retornando valores seguros.
 */
const ScoreStorage = {
  // Chave estável do placar; não depende do nome visual atual para preservar dados existentes.
  scoreKey: "palavra.forca.placar",
  // Chave estável da última dificuldade, mantida separada para leitura e recuperação simples.
  levelKey: "palavra.forca.dificuldade",
  /**
   * Cria um placar novo e independente para cada dificuldade.
   * Existe como fonte única dos valores padrão usados na primeira visita ou após falhas.
   * @returns {Object<string, {wins: number, losses: number}>} Placar zerado por nível.
   */
  emptyScore() {
    /** Callback que converte cada nível em uma entrada zerada.
     * @param {string} level Nível atual da iteração.
     * @returns {[string, {wins: number, losses: number}]} Par chave/valor aceito por Object.fromEntries.
     */
    return Object.fromEntries(LEVELS.map(level => [level, { wins: 0, losses: 0 }]));
  },
  /**
   * Recupera e valida o placar persistido antes de expô-lo ao restante do jogo.
   * RF16: dados ausentes, bloqueados ou corrompidos nunca impedem uma partida.
   * @returns {Object<string, {wins: number, losses: number}>} Placar válido ou estrutura zerada.
   */
  readScore() {
    // O try cobre tanto restrições de acesso ao localStorage quanto falhas do JSON.parse.
    try {
      // Valor ausente vira null; conteúdo textual inválido lança e segue para o fallback do catch.
      const saved = JSON.parse(localStorage.getItem(this.scoreKey));
      /** A validação rejeita estruturas parciais, negativas ou não inteiras para evitar placar incoerente.
       * @param {string} level Nível obrigatório que deve existir nos dados salvos.
       * @returns {boolean} Verdadeiro somente quando vitórias e derrotas do nível são inteiros não negativos.
       */
      if (!saved || typeof saved !== "object" || !LEVELS.every(level =>
        saved[level] && Number.isSafeInteger(saved[level].wins) && saved[level].wins >= 0 &&
        Number.isSafeInteger(saved[level].losses) && saved[level].losses >= 0)) {
        // Dados semanticamente inválidos recebem o mesmo padrão seguro da primeira visita.
        return this.emptyScore();
      }
      /** Copia apenas campos conhecidos, descartando propriedades estranhas do armazenamento.
       * @param {string} level Nível válido usado para selecionar os contadores.
       * @returns {[string, {wins: number, losses: number}]} Entrada sanitizada do placar.
       */
      return Object.fromEntries(LEVELS.map(level => [level, { wins: saved[level].wins, losses: saved[level].losses }]));
    // Qualquer exceção de segurança ou conteúdo corrompido é absorvida para manter o jogo offline funcional.
    } catch {
      return this.emptyScore();
    }
  },
  /**
   * Recupera a última dificuldade somente se ela ainda pertence ao banco atual.
   * RF16: o padrão Fácil garante início previsível sem preferência válida.
   * @returns {string} `facil`, `medio` ou `dificil`; usa `facil` como fallback.
   */
  readLevel() {
    // O try cobre restrições de segurança ou indisponibilidade do localStorage.
    try {
      // A leitura simples ainda pode lançar quando armazenamento está bloqueado pelo navegador.
      const saved = localStorage.getItem(this.levelKey);
      // Valor desconhecido ou ausente não atravessa a fronteira da camada de persistência.
      return LEVELS.includes(saved) ? saved : "facil";
    // Qualquer exceção de segurança ou conteúdo corrompido é absorvida para manter o jogo offline funcional.
    } catch {
      // Falha de acesso também retorna o padrão exigido, sem interromper a inicialização.
      return "facil";
    }
  },
  /**
   * Persiste o placar imediatamente após resultados ou redefinição.
   * RF14/RF16: falhas são silenciosas porque a sessão atual deve continuar utilizável.
   * @param {Object<string, {wins: number, losses: number}>} score Placar completo por dificuldade.
   * @returns {void} Não produz valor; pode gravar no localStorage como efeito colateral.
   */
  saveScore(score) {
    // O try/catch isola cota, modo privado ou bloqueio; o comentário interno registra o fallback intencional.
    try { localStorage.setItem(this.scoreKey, JSON.stringify(score)); } catch { /* O jogo continua sem armazenamento. */ }
  },
  /**
   * Persiste a preferência de dificuldade assim que o usuário a altera.
   * @param {string} level Nível válido selecionado na interface.
   * @returns {void} Não produz valor; pode gravar no localStorage como efeito colateral.
   */
  saveLevel(level) {
    // A preferência pode se perder se o navegador bloquear a gravação, mas a rodada continua normalmente.
    try { localStorage.setItem(this.levelKey, level); } catch { /* O jogo continua sem armazenamento. */ }
  }
};


/* ==================== REGRAS DO JOGO ==================== */
// Esta fronteira mantém validação e desfechos testáveis sem depender de HTML ou persistência.
// Regras puras: este módulo não conhece elementos da página nem o armazenamento.
/** Objeto sem acesso ao DOM que concentra as transições permitidas do estado da rodada. */
const GameRules = {
  /**
   * Converte uma entrada válida em sua representação canônica para comparação.
   * RN02/RN03/RN04: aceita uma única letra, ignora caixa e faz C representar C e Ç.
   * @param {*} input Valor recebido do teclado físico ou virtual.
   * @returns {string|null} Letra A–Z em maiúscula, com Ç normalizado para C, ou null se inválida.
   */
  normalizeLetter(input) {
    // RN02: números, símbolos, acentos e entradas com mais de um caractere são ignorados.
    if (typeof input !== "string" || !/^[A-Za-zÇç]$/.test(input)) return null;
    // RN03/RN04: maiúsculas eliminam diferença de caixa e Ç converge para a jogada C.
    return input.toUpperCase() === "Ç" ? "C" : input.toUpperCase();
  },
  /**
   * Cria o estado limpo de uma rodada com palavra aleatória do nível escolhido.
   * RN07/RF02: exclui a palavra imediatamente anterior antes do sorteio.
   * @param {string} level Dificuldade usada para selecionar o banco.
   * @param {string|null} previousWord Palavra da rodada anterior, se existir.
   * @returns {{level: string, word: string, guesses: Set<string>, errors: number, status: string}} Nova rodada ativa.
   */
  newRound(level, previousWord) {
    /** Evita repetição imediata sem modificar o banco original.
     * @param {string} word Candidata do nível selecionado.
     * @returns {boolean} Verdadeiro quando a candidata difere da rodada anterior.
     */
    const choices = WORD_BANK[level].filter(word => word !== previousWord);
    // RN01/RN07: a palavra fica apenas no estado e tentativas, erros e status começam zerados/ativos.
    return { level, word: choices[Math.floor(Math.random() * choices.length)], guesses: new Set(), errors: 0, status: "playing" };
  },
  /**
   * Encerra uma rodada somente se ela ainda estiver ativa.
   * RN09/RN10/RF12: a guarda impede contabilização dupla e desfechos conflitantes.
   * @param {Object|null} round Rodada que pode sofrer a transição.
   * @param {"won"|"lost"} status Desfecho final pretendido.
   * @returns {boolean} Verdadeiro quando a transição foi aplicada uma única vez.
   * @efeitosColaterais Altera `round.status` quando a rodada está ativa.
   */
  finish(round, status) {
    // RN09/RF12: rodada ausente ou já encerrada permanece imutável.
    if (!round || round.status !== "playing") return false;
    // RN10: o único status final substitui `playing`, tornando vitória e derrota exclusivas.
    round.status = status;
    return true;
  },
  /**
   * Processa uma jogada atômica e decide acerto, erro, vitória ou derrota.
   * @param {Object|null} round Estado atual da rodada.
   * @param {*} input Entrada bruta de uma única tecla.
   * @returns {{kind: string, letter?: string, finished?: boolean}} Resultado consumido pela interface.
   * @efeitosColaterais Pode adicionar uma letra, aumentar erros e encerrar a rodada.
   */
  guess(round, input) {
    // Centralizar a normalização garante regra idêntica para teclado físico e virtual.
    const letter = this.normalizeLetter(input);
    // RF12/RN02: entradas inválidas e jogadas após o fim não alteram estado.
    if (!round || round.status !== "playing" || !letter) return { kind: "ignored" };
    // RF09: letra repetida é reconhecida antes de qualquer penalidade.
    if (round.guesses.has(letter)) return { kind: "repeated" };
    // Registra a tentativa uma única vez para renderização e verificações posteriores.
    round.guesses.add(letter);
    /** RF05/RN04: procura qualquer ocorrência usando a mesma equivalência entre C e Ç.
     * @param {string} character Caractere da palavra secreta.
     * @returns {boolean} Verdadeiro quando o caractere corresponde à jogada normalizada.
     */
    const correct = [...round.word].some(character => this.normalizeLetter(character) === letter);
    // RF05/RF06: somente ausência total da letra consome uma das seis chances.
    if (!correct) round.errors++;
    // RF10/RN05: a sexta falha encerra imediatamente como derrota, mesmo faltando uma letra.
    if (round.errors === MAX_ERRORS) this.finish(round, "lost");
    /** RF10: vitória exige que cada caractere esteja coberto pelas tentativas normalizadas.
     * @param {string} character Caractere avaliado na palavra secreta.
     * @returns {boolean} Verdadeiro quando a letra correspondente já foi descoberta.
     */
    // O else garante que vitória e derrota nunca ocorram na mesma jogada.
    else if ([...round.word].every(character => round.guesses.has(this.normalizeLetter(character)))) this.finish(round, "won");
    // A resposta descreve a transição sem expor ao DOM como ela deve ser apresentada.
    return { kind: correct ? "correct" : "wrong", letter, finished: round.status !== "playing" };
  }
};


/* ==================== INTERFACE (DOM) ==================== */
// Cache dos elementos identificados no HTML; evita buscas repetidas e centraliza o contrato de IDs.
const ui = {
  // Configuração e números do placar da dificuldade selecionada.
  difficulty: document.getElementById("difficulty"), wins: document.getElementById("wins"), losses: document.getElementById("losses"),
  // Ação de zerar, contêiner da palavra e região viva de mensagens.
  resetScore: document.getElementById("reset-score"), word: document.getElementById("word"), feedback: document.getElementById("feedback"),
  // Histórico, teclado virtual e total textual de erros.
  attempted: document.getElementById("attempted"), keyboard: document.getElementById("keyboard"), errors: document.getElementById("error-count"),
  // Texto e invólucro visual das chances restantes.
  remaining: document.getElementById("remaining"), remainingPill: document.getElementById("remaining-pill"),
  // Descrição acessível do SVG e ação principal de reinício.
  drawingDescription: document.getElementById("drawing-description"), newGame: document.getElementById("new-game"),
  // Cartão final e seu ícone puramente visual.
  result: document.getElementById("result"), resultIcon: document.getElementById("result-icon"),
  // Rótulo e título que variam entre vitória e derrota.
  resultKicker: document.getElementById("result-kicker"), resultTitle: document.getElementById("result-title"),
  // Palavra revelada no desfecho e botão secundário de nova rodada.
  resultDetail: document.getElementById("result-detail"), resultRestart: document.getElementById("result-restart")
};
// Elementos SVG na ordem exata em que os seis erros devem revelar o boneco.
const bodyParts = ["head", "torso", "left-arm", "right-arm", "left-leg", "right-leg"]
  /** Resolve o sufixo de cada membro para o id correspondente no SVG.
   * @param {string} part Sufixo sem o prefixo `part-`.
   * @returns {HTMLElement|null} Elemento gráfico associado ao erro.
   */
  .map(part => document.getElementById(`part-${part}`));

/* ==================== ESTADO DO JOGO ==================== */
// RF14/RF16: placar mutável em memória, inicializado pela camada segura de persistência.
let score = ScoreStorage.readScore();
// RF01/RF16: nível ativo, sempre `facil`, `medio` ou `dificil`.
let selectedLevel = ScoreStorage.readLevel();
// Rodada atual: null antes do início ou objeto com status `playing`, `won` ou `lost`.
let round = null;
// RN07: última palavra usada, necessária apenas para impedir repetição consecutiva.
let previousWord = null;


/* ==================== RENDERIZAÇÃO DA INTERFACE ==================== */
/**
 * Atualiza os números visíveis do nível atualmente selecionado.
 * Existe para manter a interface sincronizada após carregar, pontuar ou zerar.
 * @returns {void} Não retorna valor; altera os textos de #wins e #losses.
 */
function renderScore() {
  // O recorte por nível aplica RF14 sem misturar estatísticas das dificuldades.
  const current = score[selectedLevel];
  // Dois dígitos estabilizam visualmente o placar sem alterar seu valor numérico.
  ui.wins.textContent = String(current.wins).padStart(2, "0");
  ui.losses.textContent = String(current.losses).padStart(2, "0");
}

/**
 * Publica feedback imediato e aplica o estado visual adequado.
 * @param {string} message Frase que será anunciada e exibida.
 * @param {""|"success"|"error"} type Modificador visual opcional.
 * @returns {void} Não retorna valor; atualiza texto e classe da região aria-live.
 */
function showFeedback(message, type = "") {
  // textContent evita interpretar a mensagem como marcação e mantém anúncio previsível.
  ui.feedback.textContent = message;
  ui.feedback.className = `feedback ${type}`.trim();
}

/**
 * Reconstrói os slots visuais da palavra conforme tentativas e desfecho.
 * RF03/RF05/RF11: oculta letras pendentes, revela ocorrências e mostra tudo ao final.
 * @returns {void} Não retorna valor; substitui filhos e aria-label de #word.
 */
function renderWord() {
  // Antes da primeira rodada, o placeholder original deve permanecer intacto.
  if (!round) return;
  // O desfecho libera a palavra completa, inclusive letras nunca tentadas.
  const finished = round.status !== "playing";
  // Remove slots antigos para que cada renderização reflita somente o estado atual.
  ui.word.replaceChildren();
  // Um slot por caractere preserva tamanho e todas as ocorrências da palavra.
  for (const character of round.word) {
    // RN04: Ç é considerada descoberta pela tentativa C.
    const discovered = round.guesses.has(GameRules.normalizeLetter(character));
    // Elementos individuais permitem animação e estado visual por posição.
    const slot = document.createElement("span");
    // Classes distinguem acerto durante o jogo e revelação forçada após derrota.
    slot.className = `letter-slot${discovered ? " revealed" : ""}${finished && !discovered ? " final-reveal" : ""}`;
    // RN01/RF11: a letra secreta só aparece por acerto ou ao terminar a rodada.
    slot.textContent = discovered || finished ? character : "_";
    ui.word.append(slot);
  }
  // O rótulo acessível descreve o progresso sem exigir interpretação visual dos traços.
  ui.word.setAttribute("aria-label", finished ? `Palavra: ${round.word}` :
    /** Converte cada posição em letra conhecida ou descrição explícita de ocultação.
     * @param {string} char Caractere na posição anunciada.
     * @returns {string} Letra descoberta ou expressão “não revelada”.
     */
    `Palavra de ${round.word.length} letras: ${[...round.word].map(char => round.guesses.has(GameRules.normalizeLetter(char)) ? char : "não revelada").join(", ")}`);
}

/**
 * Sincroniza disponibilidade, símbolo, classe e nome acessível de cada tecla.
 * RF07/RF12: estados continuam distinguíveis por cor, ✓/× e bloqueio nativo.
 * @returns {void} Não retorna valor; altera botões já presentes em #keyboard.
 */
function renderKeyboard() {
  // Percorre os botões existentes para preservar listeners e foco sempre que possível.
  for (const key of ui.keyboard.children) {
    // Optional chaining mantém todas as teclas bloqueadas antes da primeira rodada.
    const guessed = round?.guesses.has(key.dataset.letter);
    /** Reaplica a equivalência C/Ç para classificar visualmente uma tentativa existente.
     * @param {string} char Caractere da palavra comparado à tecla.
     * @returns {boolean} Verdadeiro se a tecla representa ao menos uma ocorrência.
     */
    const correct = guessed && [...round.word].some(char => GameRules.normalizeLetter(char) === key.dataset.letter);
    // RF09/RF12: repetidas e partidas inativas não aceitam clique adicional.
    key.disabled = !round || round.status !== "playing" || guessed;
    // O estado semântico escolhe a classe; o CSS fornece distinção redundante.
    key.className = `key${guessed ? correct ? " correct" : " incorrect" : ""}`;
    // ✓ e × tornam acerto e erro compreensíveis sem depender apenas de cor.
    key.textContent = guessed ? `${key.dataset.letter} ${correct ? "✓" : "×"}` : key.dataset.letter;
    // O nome acessível acompanha o mesmo estado mostrado visualmente.
    key.setAttribute("aria-label", `Letra ${key.dataset.letter}${guessed ? correct ? ", acerto" : ", erro" : ""}`);
  }
}

/**
 * Atualiza toda a representação de uma rodada a partir de um único estado.
 * @returns {void} Não retorna valor; altera palavra, contadores, SVG, tentativas e teclado.
 */
function renderRound() {
  // A palavra é renderizada antes dos indicadores para manter leitura em ordem natural.
  renderWord();
  // RF08: chances derivam dos erros para evitar dois contadores divergentes.
  const left = MAX_ERRORS - round.errors;
  ui.errors.textContent = `Erros: ${round.errors}/${MAX_ERRORS}`;
  ui.remaining.textContent = `${left} ${left === 1 ? "chance" : "chances"}`;
  // O alerta antecipado aumenta a percepção de risco nas duas últimas chances.
  ui.remainingPill.classList.toggle("danger", left <= 2);
  // A descrição do SVG oferece equivalente textual do desenho para leitores de tela.
  ui.drawingDescription.textContent = `${round.errors} ${round.errors === 1 ? "parte desenhada" : "partes desenhadas"} de ${MAX_ERRORS}.`;
  /** RF06: revela exatamente uma parte para cada erro acumulado.
   * @param {HTMLElement} part Parte do boneco na ordem de desenho.
   * @param {number} index Posição de zero a cinco usada contra o total de erros.
   * @returns {void} Alterna a classe `drawn` como efeito colateral visual.
   */
  bodyParts.forEach((part, index) => part.classList.toggle("drawn", index < round.errors));
  // Reconstruir chips evita duplicações ao renderizar o mesmo estado.
  ui.attempted.replaceChildren();
  // Um texto explícito comunica que a lista vazia é intencional.
  if (round.guesses.size === 0) {
    // O placeholder é recriado porque replaceChildren removeu a marcação inicial.
    const empty = document.createElement("span");
    empty.className = "empty-attempts";
    empty.textContent = "Nenhuma letra ainda";
    ui.attempted.append(empty);
  } else {
    // Set preserva a ordem real das tentativas e garante uma ocorrência por letra.
    for (const letter of round.guesses) {
      /** Classifica o chip com a mesma regra C/Ç usada na jogada.
       * @param {string} char Caractere da palavra secreta.
       * @returns {boolean} Verdadeiro se a tentativa corresponde à palavra.
       */
      const correct = [...round.word].some(char => GameRules.normalizeLetter(char) === letter);
      // Um elemento por tentativa permite estado visual e nome acessível próprios.
      const chip = document.createElement("span");
      chip.className = `attempt-chip ${correct ? "correct" : "incorrect"}`;
      // Os símbolos garantem distinção não baseada exclusivamente em cor.
      chip.textContent = `${letter} ${correct ? "✓" : "×"}`;
      // O leitor de tela recebe palavras completas em vez de depender do símbolo.
      chip.setAttribute("aria-label", `${letter}: ${correct ? "acerto" : "erro"}`);
      ui.attempted.append(chip);
    }
  }
  // Por fim, sincroniza bloqueios e estados das teclas com a rodada recém-renderizada.
  renderKeyboard();
}


/* ==================== COORDENAÇÃO DA PARTIDA ==================== */
/**
 * Contabiliza o desfecho da rodada no nível em que ela começou.
 * RN09/RF14: grava imediatamente e atualiza a visualização correspondente.
 * @returns {void} Não retorna valor; altera placar, localStorage e DOM.
 */
function recordResult() {
  // O status final escolhe um único contador, preservando exclusividade de resultados.
  const field = round.status === "won" ? "wins" : "losses";
  // round.level evita atribuir o resultado a uma dificuldade selecionada posteriormente.
  score[round.level][field]++;
  // RF16: o novo total é salvo logo após o desfecho, antes de depender de outra interação.
  ScoreStorage.saveScore(score);
  // Reflete imediatamente o contador alterado no placar visível.
  renderScore();
}

/**
 * Revela e preenche o cartão final de vitória ou derrota.
 * RF11: sempre inclui a palavra secreta e uma ação de nova partida.
 * @returns {void} Não retorna valor; altera conteúdo e visibilidade de #result.
 */
function showResult() {
  // Um único booleano mantém textos, classes e ícone coerentes entre si.
  const won = round.status === "won";
  // Remover hidden também torna a região aria-live disponível para anúncio.
  ui.result.hidden = false;
  // A classe de derrota controla tom visual e animação do boneco no CSS.
  ui.result.classList.toggle("lost", !won);
  ui.resultIcon.textContent = won ? "✓" : "×";
  ui.resultKicker.textContent = won ? "CORDA AFROUXADA" : "FIM DE JOGO";
  ui.resultTitle.textContent = won ? "Você escapou!" : "A corda venceu.";
  // A palavra usa <strong> para destaque visual, mas entra via textContent por segurança.
  ui.resultDetail.replaceChildren("A palavra era ", Object.assign(document.createElement("strong"), { textContent: round.word }), `. ${won ? "Por pouco, hein?" : "Respire e tente outra vez."}`);
}

/**
 * Inicia uma rodada nova e encerra como derrota uma partida ainda ativa.
 * RF13/RN07/RN09: zera o estado da partida, preserva placar e evita palavra consecutiva.
 * @returns {void} Não retorna valor; pode pontuar, substitui `round` e atualiza o DOM.
 */
function startRound() {
  // Captura a palavra antes da substituição para feedback de abandono.
  const interruptedWord = round?.status === "playing" ? round.word : null;
  // RN09: finish autoriza a derrota por interrupção apenas uma vez antes de registrar.
  if (interruptedWord && GameRules.finish(round, "lost")) recordResult();
  // RN07: qualquer rodada anterior fornece a exclusão do próximo sorteio.
  if (round) previousWord = round.word;
  // Todo estado transitório é substituído; o placar permanece fora de round.
  round = GameRules.newRound(selectedLevel, previousWord);
  // O desfecho anterior sai da navegação e da visualização na nova rodada.
  ui.result.hidden = true;
  // Restaura o rótulo e mantém a seta decorativa oculta de leitores de tela.
  ui.newGame.innerHTML = 'Nova partida <span aria-hidden="true">↗</span>';
  // Informa se houve interrupção sem esconder a palavra abandonada do usuário.
  showFeedback(interruptedWord ? `Partida anterior encerrada: a palavra era ${interruptedWord}. Nova partida iniciada!` : "Partida iniciada. Escolha uma letra!");
  // Desenha o estado inicial limpo da nova rodada e reabilita as entradas.
  renderRound();
}

/**
 * Faz a ponte entre uma entrada do usuário, as regras puras e a renderização.
 * @param {*} input Tecla física ou letra associada ao botão virtual.
 * @returns {void} Não retorna valor; pode alterar rodada, placar, persistência e DOM.
 */
function handleGuess(input) {
  // Somente GameRules decide se a jogada é válida e como ela afeta o estado.
  const result = GameRules.guess(round, input);
  // RF09/RF12: ignoradas e repetidas não produzem penalidade nem nova renderização.
  if (result.kind === "ignored" || result.kind === "repeated") return;
  // Desfechos são persistidos antes da interface para reduzir risco de placar desatualizado.
  if (result.finished) {
    // RN09: GameRules já bloqueou novas jogadas, então este resultado é contabilizado uma vez.
    recordResult();
    // RF11: apresenta o desfecho e revela a palavra assim que a rodada termina.
    showResult();
    // A região viva anuncia o resultado sem depender da leitura visual do cartão.
    showFeedback(round.status === "won" ? `Você escapou! A palavra era ${round.word}.` : `A corda venceu. A palavra era ${round.word}.`, round.status === "won" ? "success" : "error");
  } else {
    // Enquanto a rodada continua, oferece retorno curto específico para acerto ou erro.
    showFeedback(result.kind === "correct" ? `Boa! A letra ${result.letter} está na palavra.` : `Ops. Não tem a letra ${result.letter} por aqui.`, result.kind === "correct" ? "success" : "error");
  }
  // Jogadas aceitas sempre terminam com DOM sincronizado ao estado atual.
  renderRound();
}

/**
 * Cria uma única vez as 26 teclas virtuais e conecta cada uma à entrada comum.
 * RF04: não cria tecla Ç porque a jogada C cobre ambas as grafias.
 * @returns {void} Não retorna valor; adiciona botões e listeners a #keyboard.
 */
function buildKeyboard() {
  // A constante fixa evita teclas inesperadas ou dependência do banco de palavras.
  for (const letter of ALPHABET) {
    // Botões nativos fornecem foco, ativação por teclado e estado disabled acessíveis.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key";
    // data-letter guarda a identidade estável usada nas renderizações posteriores.
    button.dataset.letter = letter;
    button.textContent = letter;
    // Nome explícito evita pronúncias ambíguas de botões com um único caractere.
    button.setAttribute("aria-label", `Letra ${letter}`);
    /** Trata o clique em uma tecla virtual encaminhando-o à mesma rotina do teclado físico.
     * @returns {void} O retorno de handleGuess não é utilizado pelo evento.
     */
    button.addEventListener("click", () => handleGuess(letter));
    ui.keyboard.append(button);
  }
  // O primeiro render deixa teclas bloqueadas até a rodada ser iniciada.
  renderKeyboard();
}


/* ==================== INICIALIZAÇÃO ==================== */
// RF16: reflete no seletor a preferência recuperada antes de exibir o placar.
ui.difficulty.value = selectedLevel;
// Mostra imediatamente os totais do nível restaurado.
renderScore();
// Monta os controles virtuais uma única vez; renders futuros apenas atualizam estados.
buildKeyboard();

/* ==================== EVENTOS ==================== */
// RF13: o botão principal inicia ou reinicia sem recarregar a página.
ui.newGame.addEventListener("click", startRound);
// RF13: o botão do resultado reutiliza exatamente a mesma transição de nova partida.
ui.resultRestart.addEventListener("click", startRound);
/**
 * Trata a troca de dificuldade feita no seletor.
 * RF01/RN08: se houver partida ativa, startRound registra derrota no nível anterior e inicia a nova.
 * @returns {void} Persiste a seleção e pode substituir a rodada atual.
 */
ui.difficulty.addEventListener("change", () => {
  // A captura ocorre antes de trocar o nível para decidir se a rodada deve reiniciar.
  const wasPlaying = round?.status === "playing";
  // O valor vem das opções fixas do HTML e passa a orientar placar e próximo sorteio.
  selectedLevel = ui.difficulty.value;
  // RF16: a preferência é salva imediatamente, mesmo antes de uma nova jogada.
  ScoreStorage.saveLevel(selectedLevel);
  // O placar muda de contexto junto com o seletor, sem misturar níveis.
  renderScore();
  // RN08: uma partida em andamento vira derrota; uma já encerrada apenas dá lugar à nova.
  if (wasPlaying || round) startRound();
  // Antes da primeira rodada, mudar o nível não cria resultado nem sorteia palavra.
  else showFeedback("Nível escolhido. Comece a jogar!");
});
/**
 * Trata o pedido de zerar todo o placar.
 * RF15: exige confirmação e não interfere na rodada em andamento.
 * @returns {void} Pode substituir, persistir e renderizar o placar.
 */
ui.resetScore.addEventListener("click", () => {
  // O cancelamento encerra o listener antes de qualquer mutação ou gravação.
  if (!window.confirm("Zerar o placar de todas as dificuldades? Essa ação não pode ser desfeita.")) return;
  // Uma estrutura nova evita manter referências aos contadores anteriores.
  score = ScoreStorage.emptyScore();
  // RF15/RF16: a redefinição confirmada é persistida imediatamente.
  ScoreStorage.saveScore(score);
  // Atualiza os números sem reiniciar nem modificar a rodada em andamento.
  renderScore();
  // O texto confirma RF15 e deixa explícito que o estado da rodada foi preservado.
  showFeedback("Placar zerado. A partida atual continua normalmente.");
});
/**
 * Trata letras do teclado físico em qualquer ponto seguro da página.
 * RF04: compartilha normalização e processamento com o teclado virtual.
 * @param {KeyboardEvent} event Evento de tecla emitido pelo documento.
 * @returns {void} Pode encaminhar uma única letra válida para handleGuess.
 */
document.addEventListener("keydown", event => {
  // Atalhos, repetição automática e digitação em campos são ignorados para não sequestrar interações.
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  // RN02–RN04: a mesma validação limita a entrada a uma letra e trata Ç como C.
  const letter = GameRules.normalizeLetter(event.key);
  // Somente entrada normalizada alcança a transição de jogada.
  if (letter) handleGuess(letter);
});
