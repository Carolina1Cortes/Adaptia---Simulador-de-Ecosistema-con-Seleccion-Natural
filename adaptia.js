const FILAS    = 10;
const COLUMNAS = 10;
const grid     = document.getElementById("grid");

let intervaloSimulacion = null;
let velocidadSimulacion = 500;
let criaturaSeleccionada = null;

// ================================
// VARIABLES GLOBALES
// ================================
let contadorID = 1;
let plantas    = [];

// Registro de estadísticas por generación (para la gráfica evolutiva)
// { gen: N, velProm: X, consumoProm: Y, poblacion: Z }
let historialEvo = [];

// ================================
// ANIMACIÓN DE SPRITES
// ================================
const SPRITES = {
  jabali: { carpeta: "jabali", frames: 4, frameActual: 0 },
  ciervo: { carpeta: "ciervo", frames: 4, frameActual: 0 },
  pajaro: { carpeta: "pajaro", frames: 4, frameActual: 0 },
  zorro:  { carpeta: "zorro",  frames: 4, frameActual: 0 },
  liebre: { carpeta: "liebre", frames: 4, frameActual: 0 },
};

function getSrc(especie) {
  const s = SPRITES[especie];
  const num = String(s.frameActual).padStart(3, "0");
  return `${s.carpeta}/tile${num}.png`;
}

function avanzarFrames() {
  for (const especie in SPRITES) {
    const s = SPRITES[especie];
    s.frameActual = (s.frameActual + 1) % s.frames;
  }
  document.querySelectorAll("img[data-especie]").forEach(img => {
    img.src = getSrc(img.dataset.especie);
  });
}
setInterval(avanzarFrames, 200);

// ================================
// ARREGLO 2D (mapa)
// ================================
let mapa = [];
for (let i = 0; i < FILAS; i++) {
  mapa[i] = [];
  for (let j = 0; j < COLUMNAS; j++) mapa[i][j] = null;
}

// ================================
// MAPA DE TERRENOS
// ================================
let terrenos = [];

function esCeldaBloqueada(fila, columna) {
  const t = terrenos[fila][columna];
  return t === "arbol" || t === "roca" || t === "agua";
}

function esCeldaBloqueadaPajaro(fila, columna) {
  const t = terrenos[fila][columna];
  return t === "roca" || t === "agua";
}

function generarTerrenos() {
  for (let i = 0; i < FILAS; i++) {
    terrenos[i] = [];
    for (let j = 0; j < COLUMNAS; j++) terrenos[i][j] = "pasto";
  }

  for (let i = FILAS - 3; i < FILAS; i++)
    for (let j = COLUMNAS - 3; j < COLUMNAS; j++)
      terrenos[i][j] = "agua";

  const posArboles = [[0,3],[1,7],[2,1],[3,5],[4,8],[5,2],[6,6],[7,0]];
  for (const [f,c] of posArboles) terrenos[f][c] = "arbol";

  const posRocas = [[0,6],[2,4],[4,1],[5,8],[6,3],[8,5]];
  for (const [f,c] of posRocas)
    if (terrenos[f][c] === "pasto") terrenos[f][c] = "roca";

  const posArbustos = [[1,4],[3,8],[5,5],[7,3],[8,1],[9,6]];
  for (const [f,c] of posArbustos)
    if (terrenos[f][c] === "pasto") terrenos[f][c] = "arbusto";

  const decos = ["planta1","planta2","planta3","pasto","pasto","pasto","pasto"];
  for (let i = 0; i < FILAS; i++)
    for (let j = 0; j < COLUMNAS; j++)
      if (terrenos[i][j] === "pasto" && Math.random() < 0.22)
        terrenos[i][j] = decos[Math.floor(Math.random() * decos.length)];
}

// ================================
// ESTRUCTURA 2 – DICCIONARIO (Map)
// ================================
let diccionarioCriaturas = new Map();

// ================================
// ESTRUCTURA 3 – ÁRBOL GENEALÓGICO
// ================================
class NodoGenealogico {
  constructor(criatura) {
    this.id         = criatura.id;
    this.tipo       = criatura.tipo;
    this.especie    = criatura.especie;
    this.generacion = criatura.generacion;
    this.velocidad  = criatura.velocidad;
    this.energia    = criatura.energia;
    this.padre      = null;  // padre principal
    this.madre      = null;  // segundo progenitor
    this.hijos      = [];
  }
}

class ArbolGenealogico {
  constructor() { this.raices = []; this.nodos = new Map(); }

  agregarCriatura(criatura, padreID = null, madreID = null) {
    const nodo = new NodoGenealogico(criatura);
    this.nodos.set(nodo.id, nodo);
    if (padreID === null) {
      this.raices.push(nodo);
    } else {
      const padre = this.nodos.get(padreID);
      // Solo el padre principal es dueño del hijo en el árbol
      if (padre) { nodo.padre = padre; padre.hijos.push(nodo); }
      if (madreID) {
        const madre = this.nodos.get(madreID);
        // La madre también registra al hijo para que su árbol ramifique
        if (madre) { nodo.madre = madre; /* madre NO es dueña del nodo en el árbol */ }
      }
    }
  }

  obtenerAncestros(id) {
    // BFS hacia arriba para incluir ambos progenitores
    const visitados = new Set();
    const cola = [this.nodos.get(id)];
    const todos = [];
    while (cola.length > 0) {
      const actual = cola.shift();
      if (!actual || visitados.has(actual.id)) continue;
      visitados.add(actual.id);
      todos.push(actual);
      if (actual.padre) cola.push(actual.padre);
      if (actual.madre) cola.push(actual.madre);
    }
    // Ordenar por generación ascendente
    todos.sort((a, b) => a.generacion - b.generacion);
    return todos;
  }

  obtenerGeneracionMaxima() {
    let max = 1;
    for (const nodo of this.nodos.values())
      if (nodo.generacion > max) max = nodo.generacion;
    return max;
  }

  limpiar() { this.raices = []; this.nodos.clear(); }
}
const arbolGenealogico = new ArbolGenealogico();

// ================================
// ESTRUCTURA 4 – GRAFO DE INTERACCIONES
// ================================
class GrafoInteracciones {
  constructor() {
    // nodos: Map<especie, { tipo, emoji }>
    // aristas: Map<especie, Array<{ destino, relacion }>>
    this.nodos   = new Map();
    this.aristas = new Map();
  }

  agregarNodo(especie, tipo, emoji) {
    this.nodos.set(especie, { tipo, emoji });
    if (!this.aristas.has(especie)) this.aristas.set(especie, []);
  }

  agregarArista(origen, destino, relacion) {
    if (!this.aristas.has(origen)) this.aristas.set(origen, []);
    this.aristas.get(origen).push({ destino, relacion });
  }

  obtenerVecinos(especie) {
    return this.aristas.get(especie) ?? [];
  }

  // Recorre el grafo en BFS desde una especie raíz
  bfs(inicio) {
    const visitados = new Set();
    const cola = [inicio];
    const orden = [];
    visitados.add(inicio);
    while (cola.length > 0) {
      const actual = cola.shift();
      orden.push(actual);
      for (const { destino } of this.obtenerVecinos(actual)) {
        if (!visitados.has(destino)) {
          visitados.add(destino);
          cola.push(destino);
        }
      }
    }
    return orden;
  }
}

const grafoInteracciones = new GrafoInteracciones();

// ================================
// ESTRUCTURA 5 – GRAFO ESPACIAL CON PESOS (Dijkstra)
// ================================
class GrafoEspacial {
  constructor() {
    // Divide el mapa en zonas de 5x5 → 4 zonas (2x2)
    // zona "00","01","10","11"
    this.nodos   = new Map(); // zonaId → { nombre, terreno, costo }
    this.aristas = new Map(); // zonaId → [{ destino, peso }]
    // Costos de terreno: agua es difícil de cruzar, bosque moderado, pasto fácil
    this.costoTerreno = { agua: 10, bosque: 3, pasto: 1 };
  }

  agregarZona(id, info) {
    this.nodos.set(id, info);
    if (!this.aristas.has(id)) this.aristas.set(id, []);
  }

  // Conectar con peso basado en el terreno de la zona destino
  conectar(a, b) {
    const costoA = this.costoTerreno[this.nodos.get(a)?.terreno] ?? 1;
    const costoB = this.costoTerreno[this.nodos.get(b)?.terreno] ?? 1;
    this.aristas.get(a)?.push({ destino: b, peso: costoB });
    this.aristas.get(b)?.push({ destino: a, peso: costoA });
  }

  zonaDesCelda(fila, columna) {
    const zf = fila    < 5 ? 0 : 1;
    const zc = columna < 5 ? 0 : 1;
    return `${zf}${zc}`;
  }

  vecinosZona(id) {
    return (this.aristas.get(id) ?? []).map(a => a.destino);
  }

  vecinosConPeso(id) {
    return this.aristas.get(id) ?? [];
  }

  // Dijkstra: ruta de menor costo entre dos zonas
  // Retorna { ruta: [...], costo: N } o null
  dijkstra(origen, destino) {
    if (origen === destino) return { ruta: [origen], costo: 0 };

    // Cola de prioridad simple (array ordenado por costo acumulado)
    const cola = [{ zona: origen, costo: 0, ruta: [origen] }];
    const visitados = new Map(); // zonaId → menor costo conocido

    while (cola.length > 0) {
      // Extraer el nodo con menor costo (min-heap manual)
      cola.sort((a, b) => a.costo - b.costo);
      const { zona, costo, ruta } = cola.shift();

      if (zona === destino) return { ruta, costo };
      if (visitados.has(zona) && visitados.get(zona) <= costo) continue;
      visitados.set(zona, costo);

      for (const { destino: vecino, peso } of this.vecinosConPeso(zona)) {
        const nuevoCosto = costo + peso;
        if (!visitados.has(vecino) || visitados.get(vecino) > nuevoCosto) {
          cola.push({ zona: vecino, costo: nuevoCosto, ruta: [...ruta, vecino] });
        }
      }
    }
    return null;
  }

  // Alias para compatibilidad con el movimiento
  rutaEntreZonas(origen, destino) {
    const resultado = this.dijkstra(origen, destino);
    return resultado ? resultado.ruta : null;
  }
}

const grafoEspacial = new GrafoEspacial();

function inicializarGrafos() {
  // ── Grafo de interacciones ──
  grafoInteracciones.agregarNodo("liebre", "herbivoro", "🐰");
  grafoInteracciones.agregarNodo("ciervo", "herbivoro", "🦌");
  grafoInteracciones.agregarNodo("pajaro", "herbivoro", "🐦");
  grafoInteracciones.agregarNodo("zorro",  "carnivoro", "🦊");
  grafoInteracciones.agregarNodo("jabali", "omnivoro",  "🐗");
  grafoInteracciones.agregarNodo("planta", "planta",    "🌿");

  // Relaciones depredador → presa
  grafoInteracciones.agregarArista("zorro",  "liebre", "depredador");
  grafoInteracciones.agregarArista("zorro",  "pajaro", "depredador");
  grafoInteracciones.agregarArista("zorro",  "ciervo", "depredador");
  grafoInteracciones.agregarArista("jabali", "liebre", "depredador");
  grafoInteracciones.agregarArista("jabali", "ciervo", "depredador");
  grafoInteracciones.agregarArista("jabali", "planta", "depredador");

  // Relaciones herbívoro → planta
  grafoInteracciones.agregarArista("liebre", "planta", "herbivoro");
  grafoInteracciones.agregarArista("ciervo", "planta", "herbivoro");
  grafoInteracciones.agregarArista("pajaro", "planta", "herbivoro");

  // Competencia entre mismos niveles
  grafoInteracciones.agregarArista("zorro",  "jabali", "competencia");
  grafoInteracciones.agregarArista("liebre", "ciervo", "competencia");

  // ── Grafo espacial: 4 zonas 5×5 ──
  grafoEspacial.agregarZona("00", { nombre: "Norte-Oeste", terreno: "bosque" });
  grafoEspacial.agregarZona("01", { nombre: "Norte-Este",  terreno: "pasto"  });
  grafoEspacial.agregarZona("10", { nombre: "Sur-Oeste",   terreno: "pasto"  });
  grafoEspacial.agregarZona("11", { nombre: "Sur-Este",    terreno: "agua"   });

  grafoEspacial.conectar("00", "01");
  grafoEspacial.conectar("00", "10");
  grafoEspacial.conectar("01", "11");
  grafoEspacial.conectar("10", "11");
  grafoEspacial.conectar("00", "11"); // diagonal como atajo
}

// ================================
// ESPECIES
// ================================
const ESPECIES = {
  liebre: { tipo: "herbivoro", emoji: "🐰" },
  ciervo: { tipo: "herbivoro", emoji: "🦌" },
  pajaro: { tipo: "herbivoro", emoji: "🐦" },
  zorro:  { tipo: "carnivoro", emoji: "🦊" },
  jabali: { tipo: "omnivoro",  emoji: "🐗" },
};

const ESPECIES_GRANDES = new Set(["ciervo","jabali","zorro"]);

// ================================
// CREAR CRIATURAS Y PLANTAS
// ================================
function mutar(valor, min, max, magnitud = 0.15) {
  const rango = max - min;
  const delta = (Math.random() * 2 - 1) * magnitud * rango;
  return Math.max(min, Math.min(max, valor + delta));
}

function crearCriatura(especie, fila, columna, padre = null) {
  const info        = ESPECIES[especie];
  const energiaBase = info.tipo === "carnivoro" ? 120 : info.tipo === "omnivoro" ? 110 : 100;
  const consumoBase = info.tipo === "carnivoro" ? 5 : info.tipo === "omnivoro" ? 4 : 3;

  const velocidad = padre
    ? Math.max(1, Math.min(4, mutar(padre.velocidad, 1, 4, 0.10)))
    : Math.floor(Math.random() * 3) + 1;

  // Consumo muta muy poco (magnitud 0.05) y tiene techo bajo para no matar criaturas rápido
  const consumo = padre
    ? Math.max(2, Math.min(7, mutar(padre.consumo ?? consumoBase, 2, 7, 0.05)))
    : consumoBase;

  // EnergíaMax muta con magnitud baja también
  const energiaMax = padre
    ? Math.max(80, Math.min(160, mutar(padre.energiaMax ?? energiaBase, 80, 160, 0.08)))
    : energiaBase;

  return {
    id:         contadorID++,
    especie,
    tipo:       info.tipo,
    fila, columna,
    energia:    energiaMax,
    energiaMax,
    consumo:    Math.round(consumo * 10) / 10,
    velocidad:  Math.round(velocidad * 10) / 10,
    hambre:     0,
    generacion: padre ? padre.generacion + 1 : 1,
    padreID:    padre ? padre.id : null
  };
}

function crearPlanta(fila, columna) {
  return { tipo: "planta", especie: "planta", fila, columna };
}

function generarPlantas() {
  if (Math.random() > 0.20) return; // más plantas para sostener el ecosistema
  const fila    = Math.floor(Math.random() * FILAS);
  const columna = Math.floor(Math.random() * COLUMNAS);
  if (mapa[fila][columna] === null && !esCeldaBloqueada(fila, columna)) {
    const planta = crearPlanta(fila, columna);
    mapa[fila][columna] = planta;
    plantas.push(planta);
    agregarLog(`🌱 Planta nueva en (${fila}, ${columna})`, "nacimiento");
  }
}

// ================================
// POBLAR
// ================================
function poblar() {
  const especiesHerbi = ["liebre","liebre","ciervo","ciervo","pajaro"];

  // Helper: buscar celda libre con reintentos
  function celdaLibre(esPajaro) {
    for (let intento = 0; intento < 30; intento++) {
      const f = Math.floor(Math.random() * FILAS);
      const c = Math.floor(Math.random() * COLUMNAS);
      const bloqueado = esPajaro ? esCeldaBloqueadaPajaro(f, c) : esCeldaBloqueada(f, c);
      if (mapa[f][c] === null && !bloqueado) return { f, c };
    }
    return null;
  }

  // Garantizar al menos 2 pájaros
  for (let i = 0; i < 2; i++) {
    const pos = celdaLibre(true);
    if (pos) {
      const c = crearCriatura("pajaro", pos.f, pos.c);
      mapa[pos.f][pos.c] = c;
      diccionarioCriaturas.set(c.id, c);
      arbolGenealogico.agregarCriatura(c);
    }
  }

  // Resto de herbívoros (sin pájaro, ya están garantizados)
  const restoHerbi = ["liebre","liebre","liebre","ciervo","ciervo","ciervo"];
  for (let i = 0; i < 12; i++) {
    const especie = restoHerbi[Math.floor(Math.random() * restoHerbi.length)];
    const pos = celdaLibre(false);
    if (pos) {
      const c = crearCriatura(especie, pos.f, pos.c);
      mapa[pos.f][pos.c] = c;
      diccionarioCriaturas.set(c.id, c);
      arbolGenealogico.agregarCriatura(c);
    }
  }

  for (let i = 0; i < 2; i++) {
    const fila    = Math.floor(Math.random() * FILAS);
    const columna = Math.floor(Math.random() * COLUMNAS);
    if (mapa[fila][columna] === null && !esCeldaBloqueada(fila, columna)) {
      const c = crearCriatura("zorro", fila, columna);
      mapa[fila][columna] = c;
      diccionarioCriaturas.set(c.id, c);
      arbolGenealogico.agregarCriatura(c);
    }
  }

  for (let i = 0; i < 2; i++) {
    const fila    = Math.floor(Math.random() * FILAS);
    const columna = Math.floor(Math.random() * COLUMNAS);
    if (mapa[fila][columna] === null && !esCeldaBloqueada(fila, columna)) {
      const c = crearCriatura("jabali", fila, columna);
      mapa[fila][columna] = c;
      diccionarioCriaturas.set(c.id, c);
      arbolGenealogico.agregarCriatura(c);
    }
  }

  for (let i = 0; i < 20; i++) {
    const fila    = Math.floor(Math.random() * FILAS);
    const columna = Math.floor(Math.random() * COLUMNAS);
    if (mapa[fila][columna] === null && !esCeldaBloqueada(fila, columna)) {
      const planta = crearPlanta(fila, columna);
      mapa[fila][columna] = planta;
      plantas.push(planta);
    }
  }
}

// ================================
// MOVIMIENTO CON GRAFO ESPACIAL
// ================================

// Cuenta cuánta "comida" hay en una zona para una criatura
function contarComidaEnZona(zonaId, tipoCriatura) {
  const fBase = zonaId[0] === "0" ? 0 : 5;
  const cBase = zonaId[1] === "0" ? 0 : 5;
  let count = 0;
  for (let f = fBase; f < fBase + 5; f++) {
    for (let c = cBase; c < cBase + 5; c++) {
      const obj = mapa[f]?.[c];
      if (!obj) continue;
      if ((tipoCriatura === "herbivoro" || tipoCriatura === "omnivoro") && obj.tipo === "planta") count++;
      if ((tipoCriatura === "carnivoro" || tipoCriatura === "omnivoro") && obj.tipo === "herbivoro") count++;
    }
  }
  return count;
}

// Devuelve dirección (df, dc) de un paso hacia la zona destino
// Si ya está en la zona correcta o no hay ruta, devuelve null
function direccionHaciaZona(criatura, zonaDestino) {
  const zonaActual = grafoEspacial.zonaDesCelda(criatura.fila, criatura.columna);
  if (zonaActual === zonaDestino) return null;

  const ruta = grafoEspacial.rutaEntreZonas(zonaActual, zonaDestino);
  if (!ruta || ruta.length < 2) return null;

  // Zona intermedia: moverse hacia su centro
  const sigZona = ruta[1];
  const fBase = sigZona[0] === "0" ? 0 : 5;
  const cBase = sigZona[1] === "0" ? 0 : 5;
  const fCentro = fBase + 2;
  const cCentro = cBase + 2;

  const df = Math.sign(fCentro - criatura.fila);
  const dc = Math.sign(cCentro - criatura.columna);

  // Priorizar el eje con más diferencia para moverse de a 1 celda
  if (Math.abs(fCentro - criatura.fila) >= Math.abs(cCentro - criatura.columna)) {
    return df !== 0 ? { f: df, c: 0 } : { f: 0, c: dc };
  } else {
    return dc !== 0 ? { f: 0, c: dc } : { f: df, c: 0 };
  }
}

// Elige la mejor dirección combinando grafo espacial (60%) + instinto local (40%)
function elegirDireccion(criatura) {
  const dirs = [{f:-1,c:0},{f:1,c:0},{f:0,c:-1},{f:0,c:1}];

  // Solo usa el grafo si tiene hambre (hambre > 20) o energía baja (< 60)
  const usarGrafo = criatura.hambre > 20 || criatura.energia < 60;

  if (usarGrafo) {
    // Buscar zona con más comida accesible por el grafo
    const zonaActual = grafoEspacial.zonaDesCelda(criatura.fila, criatura.columna);
    const zonasVecinas = [zonaActual, ...grafoEspacial.vecinosZona(zonaActual)];

    let mejorZona = null;
    let maxComida = 0;
    for (const z of zonasVecinas) {
      const comida = contarComidaEnZona(z, criatura.tipo);
      if (comida > maxComida) { maxComida = comida; mejorZona = z; }
    }

    // Si encontró una zona mejor, moverse hacia ella
    if (mejorZona && mejorZona !== zonaActual && maxComida > 0) {
      const dir = direccionHaciaZona(criatura, mejorZona);
      if (dir) return dir;
    }

    // Si ya está en la mejor zona, buscar comida localmente (dirs válidas)
    const dirsConComida = dirs.filter(d => {
      const nf = criatura.fila + d.f, nc = criatura.columna + d.c;
      if (nf < 0 || nf >= FILAS || nc < 0 || nc >= COLUMNAS) return false;
      const obj = mapa[nf]?.[nc];
      if (!obj) return false;
      if ((criatura.tipo === "herbivoro" || criatura.tipo === "omnivoro") && obj.tipo === "planta") return true;
      if ((criatura.tipo === "carnivoro" || criatura.tipo === "omnivoro") && obj.tipo === "herbivoro") return true;
      return false;
    });
    if (dirsConComida.length > 0)
      return dirsConComida[Math.floor(Math.random() * dirsConComida.length)];
  }

  // Movimiento aleatorio por defecto
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function moverCriatura(criatura) {
  const dir = elegirDireccion(criatura);
  const nf  = criatura.fila    + dir.f;
  const nc  = criatura.columna + dir.c;

  if (nf < 0 || nf >= FILAS || nc < 0 || nc >= COLUMNAS) { criatura.energia -= (criatura.consumo ?? 5); criatura.hambre++; return; }

  const bloqueado = criatura.especie === "pajaro"
    ? esCeldaBloqueadaPajaro(nf, nc)
    : esCeldaBloqueada(nf, nc);
  if (bloqueado) { criatura.energia -= (criatura.consumo ?? 5); criatura.hambre++; return; }

  const objetivo = mapa[nf][nc];

  if ((criatura.tipo === "herbivoro" || criatura.tipo === "omnivoro") &&
      objetivo && objetivo.tipo === "planta") {
    criatura.energia += 20; criatura.hambre = 0;
    plantas = plantas.filter(p => !(p.fila === nf && p.columna === nc));
    mapa[criatura.fila][criatura.columna] = null;
    criatura.fila = nf; criatura.columna = nc;
    mapa[nf][nc] = criatura;
    return;
  }

  if ((criatura.tipo === "carnivoro" || criatura.tipo === "omnivoro") &&
      objetivo && objetivo.tipo === "herbivoro") {
    criatura.energia += 40; criatura.hambre = 0;
    const e1 = ESPECIES[criatura.especie]?.emoji ?? "🐾";
    const e2 = ESPECIES[objetivo.especie]?.emoji  ?? "🐾";
    agregarLog(`${e1} ${criatura.especie} #${criatura.id} cazó ${e2} ${objetivo.especie} #${objetivo.id}`, "caza");
    diccionarioCriaturas.delete(objetivo.id);
    mapa[criatura.fila][criatura.columna] = null;
    criatura.fila = nf; criatura.columna = nc;
    mapa[nf][nc] = criatura;
    return;
  }

  if (objetivo === null) {
    mapa[criatura.fila][criatura.columna] = null;
    criatura.fila = nf; criatura.columna = nc;
    mapa[nf][nc] = criatura;
  }

  criatura.energia -= (criatura.consumo ?? 5);
  criatura.hambre++;
}

// ================================
// REPRODUCCIÓN
// ================================
function reproducir(criatura) {
  if (criatura.energia < 55) return;
  if (Math.random() > 0.08)  return;

  const dirs = [{f:-1,c:0},{f:1,c:0},{f:0,c:-1},{f:0,c:1}];

  // Buscar pareja: elegir aleatoriamente entre todas las candidatas de la misma especie
  let pareja = null;
  const candidatas = [];
  for (const candidata of diccionarioCriaturas.values()) {
    if (candidata.id !== criatura.id
        && candidata.especie === criatura.especie
        && candidata.energia >= 45) {
      candidatas.push(candidata);
    }
  }
  if (candidatas.length > 0) {
    pareja = candidatas[Math.floor(Math.random() * candidatas.length)];
  }

  // Buscar celda libre para el hijo
  for (const dir of dirs) {
    const nf = criatura.fila + dir.f, nc = criatura.columna + dir.c;
    if (nf < 0 || nf >= FILAS || nc < 0 || nc >= COLUMNAS) continue;
    const bloqueado = criatura.especie === "pajaro"
      ? esCeldaBloqueadaPajaro(nf, nc)
      : esCeldaBloqueada(nf, nc);
    if (mapa[nf][nc] === null && !bloqueado) {
      // Crear hijo con herencia de ambos progenitores si hay pareja
      const hijo = pareja
        ? crearCriaturaConDosPadres(criatura.especie, nf, nc, criatura, pareja)
        : crearCriatura(criatura.especie, nf, nc, criatura);
      hijo.energia = Math.floor(hijo.energiaMax * 0.75);
      criatura.energia -= 25;
      if (pareja) pareja.energia -= 15;
      mapa[nf][nc] = hijo;
      const e = ESPECIES[hijo.especie]?.emoji ?? "🐾";
      const conPareja = pareja ? ` + #${pareja.id}` : "";
      agregarLog(`🥚 Nació ${e} ${hijo.especie} #${hijo.id} (gen ${hijo.generacion}) de #${criatura.id}${conPareja}`, "nacimiento");
      diccionarioCriaturas.set(hijo.id, hijo);
      arbolGenealogico.agregarCriatura(hijo, criatura.id, pareja?.id ?? null);
      return;
    }
  }
}

// Herencia promediada de dos padres con mutación
function crearCriaturaConDosPadres(especie, fila, columna, padre, madre) {
  const info        = ESPECIES[especie];
  const energiaBase = info.tipo === "carnivoro" ? 120 : info.tipo === "omnivoro" ? 110 : 100;
  const consumoBase = info.tipo === "carnivoro" ? 5   : info.tipo === "omnivoro" ? 4   : 3;

  // Herencia: promedio de ambos padres + mutación
  const velBase    = (padre.velocidad + madre.velocidad) / 2;
  const consBase   = ((padre.consumo ?? consumoBase) + (madre.consumo ?? consumoBase)) / 2;
  const enMaxBase  = ((padre.energiaMax ?? energiaBase) + (madre.energiaMax ?? energiaBase)) / 2;

  const velocidad  = Math.max(1, Math.min(4,   mutar(velBase,   1,   4,   0.10)));
  const consumo    = Math.max(2, Math.min(7,    mutar(consBase,  2,   7,   0.05)));
  const energiaMax = Math.max(80, Math.min(160, mutar(enMaxBase, 80, 160,  0.08)));

  return {
    id:         contadorID++,
    especie,
    tipo:       info.tipo,
    fila, columna,
    energia:    energiaMax,
    energiaMax,
    consumo:    Math.round(consumo   * 10) / 10,
    velocidad:  Math.round(velocidad * 10) / 10,
    hambre:     0,
    generacion: Math.max(padre.generacion, madre.generacion) + 1,
    padreID:    padre.id,
    madreID:    madre.id,
  };
}

// ================================
// LOOP PRINCIPAL
// ================================
function actualizar() {
  for (const criatura of [...diccionarioCriaturas.values()]) {
    if (criatura.energia <= 0) {
      mapa[criatura.fila][criatura.columna] = null;
      const e = ESPECIES[criatura.especie]?.emoji ?? "🐾";
      agregarLog(`☠️ Murió ${e} ${criatura.especie} #${criatura.id}`, "muerte");
      diccionarioCriaturas.delete(criatura.id);
      continue;
    }
    moverCriatura(criatura);
    reproducir(criatura);
  }
  generarPlantas();
  registrarEstadisticasEvo();
  renderizar();
}

function registrarEstadisticasEvo() {
  const vivos = [...diccionarioCriaturas.values()];
  if (vivos.length === 0) return;

  const genMax = arbolGenealogico.obtenerGeneracionMaxima();
  const velProm = vivos.reduce((s, c) => s + c.velocidad, 0) / vivos.length;
  const consProm = vivos.reduce((s, c) => s + (c.consumo ?? 5), 0) / vivos.length;

  // Solo guarda un punto por generación (actualiza el último si es la misma gen)
  const ultimo = historialEvo[historialEvo.length - 1];
  if (ultimo && ultimo.gen === genMax) {
    ultimo.velProm   = Math.round(velProm   * 100) / 100;
    ultimo.consProm  = Math.round(consProm  * 100) / 100;
    ultimo.poblacion = vivos.length;
  } else {
    historialEvo.push({
      gen:       genMax,
      velProm:   Math.round(velProm   * 100) / 100,
      consProm:  Math.round(consProm  * 100) / 100,
      poblacion: vivos.length,
    });
    // Máximo 20 puntos para no saturar la gráfica
    if (historialEvo.length > 20) historialEvo.shift();
  }
}

// ================================
// RENDERIZAR
// ================================
function renderizar() {
  grid.innerHTML = "";

  for (let i = 0; i < FILAS; i++) {
    for (let j = 0; j < COLUMNAS; j++) {
      const cell    = document.createElement("div");
      const terreno = terrenos[i][j];
      cell.classList.add("cell");

      if (terreno === "agua") {
        const img = document.createElement("img");
        img.className = "terrain-img";
        img.src = "tiles/agua.png";
        cell.appendChild(img);
      } else if (terreno === "arbol") {
        const img = document.createElement("img");
        img.className = "terrain-img arbol-img";
        img.src = "tiles/arbol1.png";
        cell.appendChild(img);
      } else if (terreno === "roca") {
        const img = document.createElement("img");
        img.className = "terrain-img";
        img.src = "tiles/roca.png";
        cell.appendChild(img);
      } else if (terreno === "arbusto") {
        const img = document.createElement("img");
        img.className = "terrain-img arbusto-img";
        img.src = "tiles/arbusto.png";
        cell.appendChild(img);
      } else if (terreno === "planta1" || terreno === "planta2" || terreno === "planta3") {
        const img = document.createElement("img");
        img.className = "deco-img";
        img.src = `tiles/${terreno}.png`;
        cell.appendChild(img);
      }

      const criatura = mapa[i][j];

      if (criatura) {
        if (criatura.tipo === "planta") {
          const img = document.createElement("img");
          img.className = "planta-eco";
          img.src = "planta2.png";
          cell.appendChild(img);
        } else {
          const img = document.createElement("img");
          img.src = getSrc(criatura.especie);
          img.dataset.especie = criatura.especie;
          img.draggable = false;
          img.className = ESPECIES_GRANDES.has(criatura.especie)
            ? "sprite sprite-large"
            : "sprite";

          const pct     = Math.max(0, Math.min(100, criatura.energia));
          const hpClass = pct < 30 ? "crit" : pct < 60 ? "low" : "";
          const hpBar   = document.createElement("div");
          hpBar.classList.add("hp-bar");
          hpBar.innerHTML = `<div class="hp-fill ${hpClass}" style="width:${pct}%"></div>`;

          cell.appendChild(img);
          cell.appendChild(hpBar);
          cell.classList.add("clickable");

          if (criaturaSeleccionada && criaturaSeleccionada.id === criatura.id)
            cell.classList.add("selected-cell");

          const c = criatura, fi = i, fj = j;
          cell.addEventListener("click", () => {
            criaturaSeleccionada = c;
            mostrarInformacion(c);
            document.getElementById("footerTerreno").textContent =
              `Terreno: ${terrenos[fi][fj]} (${fi}, ${fj})`;
          });
        }
      }

      grid.appendChild(cell);
    }
  }

  actualizarPanel();
  renderizarDiccionario();

  if (criaturaSeleccionada) {
    const sigueViva = diccionarioCriaturas.get(criaturaSeleccionada.id);
    if (sigueViva) mostrarInformacion(criaturaSeleccionada);
  }

  const total    = diccionarioCriaturas.size + plantas.length;
  const recursos = total > 40 ? "Abundantes" : total > 20 ? "Moderados" : "Escasos";
  document.getElementById("footerRecursos").textContent = `Recursos: ${recursos}`;
}

// ================================
// PANEL IZQUIERDO
// ================================
function actualizarPanel() {
  const vals = [...diccionarioCriaturas.values()];
  document.getElementById("countHerbivoros").textContent  = vals.filter(c => c.tipo === "herbivoro").length;
  document.getElementById("countCarnivoros").textContent  = vals.filter(c => c.tipo !== "herbivoro").length;
  document.getElementById("countPlantas").textContent     = plantas.length;
  document.getElementById("countGeneracion").textContent  = arbolGenealogico.obtenerGeneracionMaxima();
}

// ================================
// PANEL DERECHO — badge semántico
// ================================
function mostrarInformacion(criatura) {
  document.getElementById("infoID").textContent        = criatura.id;
  document.getElementById("infoGeneracion").textContent= criatura.generacion;
  document.getElementById("infoVelocidad").textContent = criatura.velocidad.toFixed(1) + " tiles/turno";
  document.getElementById("infoPosicion").textContent  = `(${criatura.fila}, ${criatura.columna})`;
  document.getElementById("infoPadre").textContent     = criatura.padreID ?? "—";
  const infoConsumo = document.getElementById("infoConsumo");
  if (infoConsumo) infoConsumo.textContent = (criatura.consumo ?? 5).toFixed(1) + " energía/turno";

  const badge = document.getElementById("badgeTipo");
  badge.textContent = criatura.especie.toUpperCase();

  // Clase semántica por tipo
  badge.className = "badge";
  if (criatura.tipo === "herbivoro") badge.classList.add("herbivore-badge");
  else if (criatura.tipo === "omnivoro") badge.classList.add("omnivore-badge");
  // carnívoro: color ámbar por defecto (sin clase extra)

  const energia = Math.max(0, Math.min(100, criatura.energia));
  document.getElementById("energiaTexto").textContent   = `${Math.floor(energia)} / 100`;
  document.getElementById("hambreTexto").textContent    = `${criatura.hambre} / 100`;
  document.getElementById("barraEnergia").style.width   = energia + "%";
  document.getElementById("barraHambre").style.width    = Math.min(100, criatura.hambre) + "%";

  document.getElementById("creaturePortrait").innerHTML =
    `<img src="${getSrc(criatura.especie)}" class="portrait-img" data-especie="${criatura.especie}">`;

  // Mostrar botón de árbol
  const btnArbol = document.getElementById("btnArbolModal");
  if (btnArbol) btnArbol.style.display = "block";
  renderizarDiccionario();
}

// ================================
// ÁRBOL – LINAJE con conectores
// ================================
function crearNodoLinajeEl(ancestro, esActual) {
  const div = document.createElement("div");
  div.classList.add("nodo-arbol");
  if (esActual) div.classList.add("nodo-actual");

  const madre = ancestro.madre ? ` · 👥 +#${ancestro.madre.id}` : "";
  div.innerHTML = `
    <img src="${getSrc(ancestro.especie)}" class="nodo-mini-img" data-especie="${ancestro.especie}">
    <div class="nodo-info">
      <span class="nodo-id">ID: ${ancestro.id}${ancestro.madre ? ' 👥' : ''}</span><br>
      <span class="nodo-gen">Gen ${ancestro.generacion} · Vel ${ancestro.velocidad.toFixed(1)}</span>
    </div>`;

  div.title = ancestro.madre
    ? `Padre: #${ancestro.padre?.id ?? '—'} · Madre: #${ancestro.madre?.id ?? '—'}`
    : `Progenitor único: #${ancestro.padre?.id ?? '—'}`;

  div.addEventListener("click", () => {
    const c = diccionarioCriaturas.get(ancestro.id);
    if (c) { criaturaSeleccionada = c; mostrarInformacion(c); }
    else {
      document.getElementById("infoID").textContent         = ancestro.id;
      document.getElementById("infoGeneracion").textContent = ancestro.generacion;
      document.getElementById("infoVelocidad").textContent  = ancestro.velocidad.toFixed(1) + " tiles/turno";
      document.getElementById("infoPosicion").textContent   = "—";
      document.getElementById("infoPadre").textContent      = ancestro.padre ? ancestro.padre.id : "—";
      const badge = document.getElementById("badgeTipo");
      badge.textContent = ancestro.especie.toUpperCase();
      badge.className = "badge" + (ancestro.tipo === "herbivoro" ? " herbivore-badge" : ancestro.tipo === "omnivoro" ? " omnivore-badge" : "");
      document.getElementById("creaturePortrait").innerHTML =
        `<img src="${getSrc(ancestro.especie)}" class="portrait-img" data-especie="${ancestro.especie}">`;
      document.getElementById("energiaTexto").textContent = "† muerto";
      document.getElementById("hambreTexto").textContent  = "—";
      document.getElementById("barraEnergia").style.width = "0%";
      document.getElementById("barraHambre").style.width  = "0%";
    }
  });
  return div;
}

function mostrarLinaje(id) {
  const contenedor = document.getElementById("linajeContainer");
  contenedor.innerHTML = "";
  const nodoActual = arbolGenealogico.nodos.get(id);
  if (!nodoActual) return;

  // Título con padres del nodo actual
  const padreStr = nodoActual.padre ? `#${nodoActual.padre.id}` : "—";
  const madreStr = nodoActual.madre ? ` ♥ #${nodoActual.madre.id}` : "";
  const header = document.createElement("div");
  header.style.cssText = "font-size:10px;color:#567060;font-family:JetBrains Mono,monospace;padding:0 0 6px 0;border-bottom:1px solid rgba(53,160,84,0.12);margin-bottom:6px;";
  header.textContent = `Padres: ${padreStr}${madreStr}`;
  contenedor.appendChild(header);

  // Mostrar el nodo actual (raíz del árbol hacia abajo)
  const raizEl = crearNodoLinajeEl(nodoActual, true);
  contenedor.appendChild(raizEl);

  // Mostrar hijos y nietos recursivamente (máx 3 niveles para no saturar)
  function renderHijos(nodo, nivelProfundidad, contenedorPadre) {
    if (nivelProfundidad > 2 || nodo.hijos.length === 0) return;

    const conector = document.createElement("div");
    conector.classList.add("nodo-connector");
    contenedorPadre.appendChild(conector);

    // Label de nivel
    const label = document.createElement("div");
    label.style.cssText = "font-size:9px;color:#35a054;font-family:JetBrains Mono,monospace;margin-bottom:3px;opacity:0.7;";
    label.textContent = nivelProfundidad === 1 ? `↳ ${nodo.hijos.length} hijo(s)` : `  ↳ nietos`;
    contenedorPadre.appendChild(label);

    // Fila de hijos
    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;flex-direction:column;gap:4px;padding-left:12px;border-left:1px solid rgba(53,160,84,0.2);";

    for (const hijo of nodo.hijos) {
      const hijoEl = crearNodoLinajeEl(hijo, false);
      fila.appendChild(hijoEl);
      // Recursivo para nietos
      renderHijos(hijo, nivelProfundidad + 1, fila);
    }
    contenedorPadre.appendChild(fila);
  }

  renderHijos(nodoActual, 1, contenedor);

  // Si no tiene hijos, mostrar mensaje
  if (nodoActual.hijos.length === 0) {
    const msg = document.createElement("div");
    msg.style.cssText = "font-size:10px;color:#344a3c;font-family:JetBrains Mono,monospace;padding-top:6px;";
    msg.textContent = "Sin descendencia registrada.";
    contenedor.appendChild(msg);
  }
}

// ================================
// DICCIONARIO — grid de cards
// ================================
function renderizarDiccionario() {
  const grid = document.getElementById("diccionarioContainer");
  grid.innerHTML = "";

  for (const [id, criatura] of diccionarioCriaturas) {
    const pct   = Math.max(0, Math.min(100, criatura.energia));
    const esSel = criaturaSeleccionada && criaturaSeleccionada.id === id;

    const card = document.createElement("div");
    card.classList.add("dict-card");
    if (esSel) card.classList.add("dict-card-selected");
    if (criatura.tipo !== "herbivoro") card.classList.add("carnivore-card");

    card.innerHTML = `
      <img src="${getSrc(criatura.especie)}" class="dict-card-sprite" data-especie="${criatura.especie}">
      <div class="dict-card-id">#${id}</div>
      <div class="dict-card-meta">Gen ${criatura.generacion}</div>
      <div class="dict-card-bar"><div class="dict-card-bar-fill" style="width:${pct}%"></div></div>`;

    card.addEventListener("click", () => { criaturaSeleccionada = criatura; mostrarInformacion(criatura); });
    grid.appendChild(card);
  }
}

// ================================
// LOG
// ================================
function agregarLog(texto, tipo = "normal") {
  const log    = document.getElementById("logContainer");
  const evento = document.createElement("div");
  evento.classList.add("evento");
  if (tipo === "muerte")     evento.classList.add("evento-muerte");
  if (tipo === "caza")       evento.classList.add("evento-caza");
  if (tipo === "nacimiento") evento.classList.add("evento-nacimiento");
  const hora = new Date().toLocaleTimeString();
  evento.innerHTML = `<span class="hora">[${hora}]</span><span>${texto}</span>`;
  log.appendChild(evento);
  log.scrollTop = log.scrollHeight;
  if (log.children.length > 50) log.removeChild(log.children[0]);
}

// ================================
// SLIDER VELOCIDAD
// ================================
const sliderVelocidad = document.getElementById("velocidadSimulacion");
const textoVelocidad  = document.getElementById("valorVelocidad");

const velocidades = [2000,1000,500,250,125];
const textos      = ["0.25x","0.5x","1x","2x","4x"];

function actualizarColorSlider() {

  const min = sliderVelocidad.min;
  const max = sliderVelocidad.max;
  const val = sliderVelocidad.value;

  const porcentaje = ((val - min) / (max - min)) * 100;

  sliderVelocidad.style.background = `
    linear-gradient(to right,
    #39e75f 0%,
    #39e75f ${porcentaje}%,
    #1b2a1b ${porcentaje}%,
    #1b2a1b 100%)
  `;
}

sliderVelocidad.addEventListener("input", () => {

  const i = parseInt(sliderVelocidad.value);

  velocidadSimulacion = velocidades[i];
  textoVelocidad.textContent = textos[i];

  actualizarColorSlider();

  if (intervaloSimulacion) {
    clearInterval(intervaloSimulacion);
    intervaloSimulacion = setInterval(actualizar, velocidadSimulacion);
  }
});

// Para que cargue bien al iniciar
actualizarColorSlider();

// ================================
// BOTONES
// ================================
document.getElementById("btnIniciar").addEventListener("click", () => {
  if (intervaloSimulacion) return;
  intervaloSimulacion = setInterval(actualizar, velocidadSimulacion);
});

document.getElementById("btnDetener").addEventListener("click", () => {
  clearInterval(intervaloSimulacion);
  intervaloSimulacion = null;
});

document.getElementById("btnReiniciar").addEventListener("click", () => {
  clearInterval(intervaloSimulacion);
  intervaloSimulacion = null;
  mapa = [];
  for (let i = 0; i < FILAS; i++) {
    mapa[i] = [];
    for (let j = 0; j < COLUMNAS; j++) mapa[i][j] = null;
  }
  plantas = [];
  diccionarioCriaturas.clear();
  arbolGenealogico.limpiar();
  contadorID = 1;
  criaturaSeleccionada = null;
  generarTerrenos();
  poblar();
  renderizar();
});

// ================================
// HOVER TERRENO en footer
// ================================
document.getElementById("grid").addEventListener("mouseover", e => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  const cells = [...document.querySelectorAll(".cell")];
  const idx   = cells.indexOf(cell);
  if (idx < 0) return;
  const fi = Math.floor(idx / COLUMNAS);
  const fj = idx % COLUMNAS;
  const t  = terrenos[fi]?.[fj] ?? "—";
  document.getElementById("footerTerreno").textContent = `Terreno: ${t} (${fi}, ${fj})`;
});

// ================================
// VISUALIZACIÓN — GRAFO DE INTERACCIONES
// ================================
function dibujarGrafoInteracciones() {
  const svg = document.getElementById("svgGrafo");
  if (!svg) return;
  svg.innerHTML = "";

  // Posiciones fijas para cada nodo (x, y)
  const pos = {
    planta:  { x: 270, y: 290 },
    liebre:  { x: 100, y: 180 },
    ciervo:  { x: 270, y: 200 },
    pajaro:  { x: 440, y: 180 },
    jabali:  { x: 130, y: 60  },
    zorro:   { x: 410, y: 60  },
  };

  const colores = {
    herbivoro: "#4ac96e",
    carnivoro: "#e08535",
    omnivoro:  "#9dcf60",
    planta:    "#27a844",
  };

  const coloresArista = {
    depredador:  "#e85555",
    herbivoro:   "#4ac96e",
    competencia: "#5b9fd4",
  };

  // Flecha marker
  const defs = document.createElementNS("http://www.w3.org/2000/svg","defs");
  ["depredador","herbivoro","competencia"].forEach(rel => {
    const marker = document.createElementNS("http://www.w3.org/2000/svg","marker");
    marker.setAttribute("id", "arrow-" + rel);
    marker.setAttribute("markerWidth","8");
    marker.setAttribute("markerHeight","8");
    marker.setAttribute("refX","6");
    marker.setAttribute("refY","3");
    marker.setAttribute("orient","auto");
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d","M0,0 L0,6 L8,3 z");
    path.setAttribute("fill", coloresArista[rel]);
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  const R = 26; // radio nodo

  // Dibujar aristas
  for (const [origen, aristas] of grafoInteracciones.aristas) {
    for (const { destino, relacion } of aristas) {
      const p1 = pos[origen];
      const p2 = pos[destino];
      if (!p1 || !p2) continue;

      // Calcular punto de inicio/fin en borde del círculo
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const ux = dx/dist, uy = dy/dist;
      const x1 = p1.x + ux*R, y1 = p1.y + uy*R;
      const x2 = p2.x - ux*(R+6), y2 = p2.y - uy*(R+6);

      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.setAttribute("stroke", coloresArista[relacion] ?? "#888");
      line.setAttribute("stroke-width", relacion === "competencia" ? "1.5" : "2");
      line.setAttribute("stroke-dasharray", relacion === "competencia" ? "5,3" : "none");
      line.setAttribute("marker-end", `url(#arrow-${relacion})`);
      line.setAttribute("opacity","0.8");
      svg.appendChild(line);
    }
  }

  // Dibujar nodos
  for (const [especie, nodo] of grafoInteracciones.nodos) {
    const p = pos[especie];
    if (!p) continue;
    const color = colores[nodo.tipo] ?? "#888";

    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    g.setAttribute("transform", `translate(${p.x},${p.y})`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg","circle");
    circle.setAttribute("r", R);
    circle.setAttribute("fill", "#0b1610");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-width","2");
    g.appendChild(circle);

    const emoji = document.createElementNS("http://www.w3.org/2000/svg","text");
    emoji.setAttribute("text-anchor","middle");
    emoji.setAttribute("dominant-baseline","central");
    emoji.setAttribute("font-size","18");
    emoji.textContent = nodo.emoji;
    g.appendChild(emoji);

    const label = document.createElementNS("http://www.w3.org/2000/svg","text");
    label.setAttribute("text-anchor","middle");
    label.setAttribute("y", R + 14);
    label.setAttribute("font-size","10");
    label.setAttribute("fill", color);
    label.setAttribute("font-family","JetBrains Mono, monospace");
    label.textContent = especie;
    g.appendChild(label);

    // Guardar especie como atributo SVG estándar
    g.setAttribute("data-especie", especie);
    g.style.cursor = "pointer";
    g.addEventListener("mouseenter", (e) => {
      const esp = e.currentTarget.getAttribute("data-especie");
      const nd  = grafoInteracciones.nodos.get(esp);
      // Plantas están en array plantas, animales en diccionarioCriaturas
      const vivos = esp === "planta"
        ? plantas.length
        : [...diccionarioCriaturas.values()].filter(c => c.especie === esp).length;
      const vecinos = grafoInteracciones.obtenerVecinos(esp);
      const relaciones = vecinos.map(v => `${v.relacion} → ${v.destino}`).join(", ") || "ninguna";

      let tooltip = document.getElementById("grafo-tooltip");
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "grafo-tooltip";
        tooltip.style.cssText = `
          position:fixed; background:#07100a; border:1px solid #35a054;
          color:#a8ccb4; font-family:JetBrains Mono,monospace; font-size:11px;
          padding:8px 12px; border-radius:6px; pointer-events:none;
          z-index:9999; max-width:220px; line-height:1.6;
          box-shadow:0 4px 20px rgba(0,0,0,0.6);
        `;
        document.body.appendChild(tooltip);
      }
      tooltip.innerHTML = `
        <strong style="color:#4ac96e">${nd?.emoji ?? '?'} ${esp.toUpperCase()}</strong><br>
        Tipo: <span style="color:#7eeaa0">${nd?.tipo ?? '—'}</span><br>
        Vivos: <span style="color:#7eeaa0">${vivos}</span><br>
        Relaciones: <span style="color:#f5aa64">${relaciones}</span>
      `;
      tooltip.style.display = "block";
    });

    g.addEventListener("mousemove", (e) => {
      const tooltip = document.getElementById("grafo-tooltip");
      if (tooltip) {
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top  = (e.clientY - 10) + "px";
      }
    });

    g.addEventListener("mouseleave", () => {
      const tooltip = document.getElementById("grafo-tooltip");
      if (tooltip) tooltip.style.display = "none";
    });

    svg.appendChild(g);
  }
}

function dibujarGrafoEspacial() {
  const svg = document.getElementById("svgEspacial");
  if (!svg) return;
  svg.innerHTML = "";
  svg.setAttribute("viewBox","0 0 540 230");
  svg.setAttribute("height","230");

  const zonasDef = {
    "00": { x: 130, y: 75,  nombre: "Norte-Oeste", colorBase: "#1a7030" },
    "01": { x: 400, y: 75,  nombre: "Norte-Este",  colorBase: "#27a844" },
    "10": { x: 130, y: 170, nombre: "Sur-Oeste",   colorBase: "#27a844" },
    "11": { x: 400, y: 170, nombre: "Sur-Este",    colorBase: "#2d6ea8" },
  };

  const conexiones = [
    ["00","01"],["00","10"],["01","11"],["10","11"],["00","11"]
  ];

  // Calcular comida en cada zona en tiempo real
  const comidaHerbi = {};
  const comidaCarni = {};
  let maxH = 1, maxC = 1;
  for (const id of Object.keys(zonasDef)) {
    comidaHerbi[id] = contarComidaEnZona(id, "herbivoro");
    comidaCarni[id] = contarComidaEnZona(id, "carnivoro");
    if (comidaHerbi[id] > maxH) maxH = comidaHerbi[id];
    if (comidaCarni[id] > maxC) maxC = comidaCarni[id];
  }

  // Costos de terreno para mostrar en aristas
  const costos = grafoEspacial.costoTerreno;

  // Aristas con peso Dijkstra
  conexiones.forEach(([a, b]) => {
    const pa = zonasDef[a], pb = zonasDef[b];
    const diagonal = (a === "00" && b === "11");
    // Peso = costo del terreno destino
    const terrenoB = grafoEspacial.nodos.get(b)?.terreno ?? "pasto";
    const peso = costos[terrenoB] ?? 1;
    // Color según peso: bajo=verde, medio=amarillo, alto=azul
    const colorArista = peso >= 8 ? "#2d6ea8" : peso >= 3 ? "#9dcf60" : "#35a054";

    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", pa.x); line.setAttribute("y1", pa.y);
    line.setAttribute("x2", pb.x); line.setAttribute("y2", pb.y);
    line.setAttribute("stroke", colorArista);
    line.setAttribute("stroke-width", diagonal ? "1.5" : "2");
    line.setAttribute("stroke-dasharray", diagonal ? "5,3" : "none");
    line.setAttribute("opacity","0.75");
    svg.appendChild(line);

    // Etiqueta con el peso en el centro de la arista
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
    bg.setAttribute("x", mx - 10); bg.setAttribute("y", my - 14);
    bg.setAttribute("width","20"); bg.setAttribute("height","13");
    bg.setAttribute("rx","3"); bg.setAttribute("fill","#07100a");
    svg.appendChild(bg);

    const etq = document.createElementNS("http://www.w3.org/2000/svg","text");
    etq.setAttribute("x", mx); etq.setAttribute("y", my - 4);
    etq.setAttribute("text-anchor","middle"); etq.setAttribute("font-size","9");
    etq.setAttribute("fill", colorArista);
    etq.setAttribute("font-family","JetBrains Mono,monospace");
    etq.setAttribute("font-weight","600");
    etq.textContent = `w=${peso}`;
    svg.appendChild(etq);
  });

  // Nodos zona con datos en vivo
  for (const [id, z] of Object.entries(zonasDef)) {
    const plantas_n = comidaHerbi[id];
    const presas_n  = comidaCarni[id];

    // Color del borde varía según densidad de comida
    const intensidad = Math.min(1, plantas_n / maxH);
    const r = Math.round(26  + intensidad * (74  - 26));
    const g2 = Math.round(112 + intensidad * (201 - 112));
    const b2 = Math.round(48  + intensidad * (110 - 48));
    const colorVivo = `rgb(${r},${g2},${b2})`;

    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    g.setAttribute("transform",`translate(${z.x},${z.y})`);

    const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x","-90"); rect.setAttribute("y","-32");
    rect.setAttribute("width","180"); rect.setAttribute("height","64");
    rect.setAttribute("rx","7");
    rect.setAttribute("fill","#07100a");
    rect.setAttribute("stroke", colorVivo);
    rect.setAttribute("stroke-width","1.8");
    g.appendChild(rect);

    // Nombre zona
    const t0 = document.createElementNS("http://www.w3.org/2000/svg","text");
    t0.setAttribute("text-anchor","middle"); t0.setAttribute("y","-16");
    t0.setAttribute("font-size","8.5"); t0.setAttribute("fill", colorVivo);
    t0.setAttribute("font-family","JetBrains Mono,monospace"); t0.setAttribute("font-weight","600");
    t0.textContent = `Zona ${id} · ${z.nombre}`;
    g.appendChild(t0);

    // Plantas en zona
    const t1 = document.createElementNS("http://www.w3.org/2000/svg","text");
    t1.setAttribute("text-anchor","middle"); t1.setAttribute("y","2");
    t1.setAttribute("font-size","10"); t1.setAttribute("fill","#4ac96e");
    t1.setAttribute("font-family","JetBrains Mono,monospace");
    t1.textContent = `🌿 ${plantas_n} plantas`;
    g.appendChild(t1);

    // Presas en zona
    const t2 = document.createElementNS("http://www.w3.org/2000/svg","text");
    t2.setAttribute("text-anchor","middle"); t2.setAttribute("y","18");
    t2.setAttribute("font-size","10"); t2.setAttribute("fill","#e08535");
    t2.setAttribute("font-family","JetBrains Mono,monospace");
    t2.textContent = `🐾 ${presas_n} presas`;
    g.appendChild(t2);

    svg.appendChild(g);
  }
}

let intervaloGrafo = null;

// ================================
// GRÁFICA EVOLUTIVA
// ================================
function dibujarGraficaEvo() {
  const svg = document.getElementById("svgEvo");
  if (!svg) return;
  svg.innerHTML = "";

  const W = 520, H = 160;
  const PAD = { top: 16, right: 20, bottom: 36, left: 40 };
  const w = W - PAD.left - PAD.right;
  const h = H - PAD.top  - PAD.bottom;

  if (historialEvo.length < 2) {
    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x", W/2); t.setAttribute("y", H/2);
    t.setAttribute("text-anchor","middle"); t.setAttribute("font-size","11");
    t.setAttribute("fill","#567060"); t.setAttribute("font-family","JetBrains Mono,monospace");
    t.textContent = "Esperando datos... (necesita ≥2 generaciones)";
    svg.appendChild(t);
    return;
  }

  const ns = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  const datos = historialEvo;
  const maxVel  = Math.max(...datos.map(d => d.velProm),  0.1) * 1.2;
  const maxCons = Math.max(...datos.map(d => d.consProm), 0.1) * 1.2;
  const maxPob  = Math.max(...datos.map(d => d.poblacion),  1) * 1.2;
  const n = datos.length;

  const xScale = i => PAD.left + (i / (n - 1)) * w;
  const yScaleVel  = v => PAD.top + h - (v / maxVel)  * h;
  const yScaleCons = v => PAD.top + h - (v / maxCons) * h;
  const yScalePob  = v => PAD.top + h - (v / maxPob)  * h;

  // Fondo
  svg.appendChild(mk("rect", { x:0, y:0, width:W, height:H, fill:"#07100a" }));

  // Líneas de cuadrícula horizontales
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (h / 4) * i;
    svg.appendChild(mk("line", {
      x1: PAD.left, y1: y, x2: PAD.left + w, y2: y,
      stroke:"rgba(53,160,84,0.1)", "stroke-width":"1"
    }));
  }

  // Eje X — etiquetas de generación
  datos.forEach((d, i) => {
    const x = xScale(i);
    const t = mk("text", {
      x, y: PAD.top + h + 16,
      "text-anchor":"middle", "font-size":"9",
      fill:"#567060", "font-family":"JetBrains Mono,monospace"
    });
    t.textContent = `G${d.gen}`;
    svg.appendChild(t);
  });

  // Función para dibujar una línea de datos
  function dibujarLinea(yScale, getData, color, etiqueta) {
    const pts = datos.map((d, i) => `${xScale(i)},${yScale(getData(d))}`).join(" ");
    svg.appendChild(mk("polyline", {
      points: pts, fill:"none", stroke: color,
      "stroke-width":"2", "stroke-linejoin":"round", "stroke-linecap":"round"
    }));
    // Puntos
    datos.forEach((d, i) => {
      const cx = xScale(i), cy = yScale(getData(d));
      svg.appendChild(mk("circle", { cx, cy, r:"3.5", fill: color }));

      // Tooltip value en el último punto
      if (i === datos.length - 1) {
        const t = mk("text", {
          x: cx + 6, y: cy - 5,
          "font-size":"9", fill: color,
          "font-family":"JetBrains Mono,monospace"
        });
        t.textContent = getData(d).toFixed(2);
        svg.appendChild(t);
      }
    });
    // Etiqueta lateral
    const t = mk("text", {
      x: PAD.left - 5, y: yScale(getData(datos[0])),
      "text-anchor":"end", "font-size":"8", fill: color,
      "font-family":"JetBrains Mono,monospace", "dominant-baseline":"middle"
    });
    t.textContent = etiqueta;
    svg.appendChild(t);
  }

  dibujarLinea(yScaleVel,  d => d.velProm,   "#4ac96e", "vel");
  dibujarLinea(yScaleCons, d => d.consProm,  "#e08535", "cons");
  dibujarLinea(yScalePob,  d => d.poblacion, "#5b9fd4", "pob");

  // Eje Y — label
  const yLabel = mk("text", {
    x: 8, y: PAD.top + h/2,
    "font-size":"8", fill:"#567060",
    "font-family":"JetBrains Mono,monospace",
    transform:`rotate(-90,8,${PAD.top + h/2})`,
    "text-anchor":"middle"
  });
  yLabel.textContent = "valor promedio";
  svg.appendChild(yLabel);
}

function toggleGrafo() {
  const modal = document.getElementById("modalGrafo");
  if (!modal) return;
  const visible = modal.style.display !== "none";
  modal.style.display = visible ? "none" : "flex";
  if (!visible) {
    dibujarGrafoInteracciones();
    dibujarGrafoEspacial();
    dibujarGraficaEvo();
    // Refrescar grafo espacial y gráfica cada 1s mientras está abierto
    intervaloGrafo = setInterval(() => {
      dibujarGrafoEspacial();
      dibujarGraficaEvo();
    }, 1000);
  } else {
    clearInterval(intervaloGrafo);
    intervaloGrafo = null;
  }
}

// ================================
// PANEL DE GENERACIONES
// ================================
let genSeleccionada = null;

function togglePanelGeneracion() {
  const modal = document.getElementById("modalGeneracion");
  if (!modal) return;
  const visible = modal.style.display !== "none";
  modal.style.display = visible ? "none" : "flex";
  if (!visible) renderPanelGeneracion();
}

function renderPanelGeneracion() {
  const genMax = arbolGenealogico.obtenerGeneracionMaxima();
  document.getElementById("tituloModalGen").textContent = `GENERACIONES (máx: ${genMax})`;

  // Botones de generación
  const btns = document.getElementById("genBtns");
  btns.innerHTML = "";
  for (let g = 1; g <= genMax; g++) {
    const btn = document.createElement("button");
    btn.textContent = `Gen ${g}`;
    btn.style.cssText = `
      font-family:JetBrains Mono,monospace; font-size:11px; padding:4px 12px;
      border-radius:4px; border:1px solid ${genSeleccionada === g ? '#4ac96e' : 'rgba(53,160,84,0.25)'};
      background:${genSeleccionada === g ? 'rgba(74,201,110,0.12)' : 'rgba(53,160,84,0.03)'};
      color:${genSeleccionada === g ? '#7eeaa0' : '#567060'}; cursor:pointer;
    `;
    btn.addEventListener("click", () => {
      genSeleccionada = g;
      renderPanelGeneracion();
    });
    btns.appendChild(btn);
  }

  if (!genSeleccionada) genSeleccionada = genMax; // por defecto la más alta

  // Criaturas de la generación seleccionada (vivas + muertas del árbol)
  const contenedor = document.getElementById("genCriaturas");
  contenedor.innerHTML = "";

  // Buscar en el árbol genealógico todos los nodos de esa generación
  const nodosGen = [...arbolGenealogico.nodos.values()]
    .filter(n => n.generacion === genSeleccionada);

  if (nodosGen.length === 0) {
    contenedor.innerHTML = `<div style="color:#567060;font-size:11px;font-family:JetBrains Mono,monospace;grid-column:span 2">Sin criaturas en esta generación aún.</div>`;
    return;
  }

  for (const nodo of nodosGen) {
    const viva = diccionarioCriaturas.get(nodo.id);
    const card = document.createElement("div");
    card.style.cssText = `
      background:#111f16; border:1px solid ${viva ? 'rgba(74,201,110,0.3)' : 'rgba(200,80,80,0.2)'};
      border-radius:6px; padding:10px; display:flex; align-items:center; gap:10px;
      cursor:pointer; transition:border-color 0.12s;
    `;

    const pct = viva ? Math.max(0, Math.min(100, viva.energia)) : 0;
    const padreInfo = nodo.padre ? `#${nodo.padre.id}` : '—';
    const madreInfo = nodo.madre ? ` + #${nodo.madre.id}` : '';

    card.innerHTML = `
      <img src="${getSrc(nodo.especie)}" style="width:32px;height:32px;object-fit:contain;image-rendering:pixelated" data-especie="${nodo.especie}">
      <div style="flex:1;font-family:JetBrains Mono,monospace">
        <div style="font-size:11px;color:${viva ? '#7eeaa0' : '#c03838'}">
          ${viva ? '🟢' : '☠️'} #${nodo.id} ${nodo.especie}
        </div>
        <div style="font-size:10px;color:#567060">Vel: ${nodo.velocidad.toFixed(1)} · Padres: ${padreInfo}${madreInfo}</div>
        <div style="height:3px;background:#0a1410;border-radius:2px;margin-top:4px">
          <div style="height:100%;width:${pct}%;background:${viva ? '#35a054' : '#6b1c1c'};border-radius:2px"></div>
        </div>
      </div>`;

    card.addEventListener("click", () => {
      if (viva) {
        criaturaSeleccionada = viva;
        mostrarInformacion(viva);
        togglePanelGeneracion(); // cerrar modal
      } else {
        // Mostrar info del nodo muerto en el árbol
        criaturaSeleccionada = null; // nodo muerto, solo mostrar árbol
        togglePanelGeneracion();
        // Abrir árbol desde la raíz de este nodo
        setTimeout(() => {
          criaturaSeleccionada = { id: nodo.id, especie: nodo.especie };
          abrirArbolModal();
        }, 200);
      }
    });

    card.addEventListener("mouseenter", () => card.style.borderColor = '#35a054');
    card.addEventListener("mouseleave", () => card.style.borderColor = viva ? 'rgba(74,201,110,0.3)' : 'rgba(200,80,80,0.2)');

    contenedor.appendChild(card);
  }
}

// ================================
// ÁRBOL GENEALÓGICO SVG MODAL
// ================================

// Encuentra la raíz más antigua de la especie de una criatura (primera en aparecer, Gen 1)
function encontrarRaizEspecie(id) {
  const nodoInicial = arbolGenealogico.nodos.get(id);
  if (!nodoInicial) return null;
  const especie = nodoInicial.especie;

  // Buscar entre todas las raíces registradas la de la misma especie con menor ID
  const raicesEspecie = arbolGenealogico.raices.filter(r => r.especie === especie);
  if (raicesEspecie.length > 0) {
    return raicesEspecie.reduce((a, b) => a.id < b.id ? a : b);
  }

  // Fallback: subir por padre hasta no tener más
  let nodo = nodoInicial;
  while (nodo.padre) nodo = nodo.padre;
  return nodo;
}

function abrirArbolModal() {
  if (!criaturaSeleccionada) return;
  const nodo = arbolGenealogico.nodos.get(criaturaSeleccionada.id);
  if (!nodo) return;
  document.getElementById("modalArbol").style.display = "flex";
  document.getElementById("tituloArbol").textContent =
    `ÁRBOL GENEALÓGICO — ${nodo.especie.toUpperCase()} #${criaturaSeleccionada.id}`;
  mostrarLinaje(criaturaSeleccionada.id);
}

function cerrarArbolModal() {
  document.getElementById("modalArbol").style.display = "none";
}

function dibujarArbolSVG(idRaiz, idResaltado = null) {
  const svg = document.getElementById("svgArbol");
  if (!svg) return;
  svg.innerHTML = "";

  const nodoRaiz = arbolGenealogico.nodos.get(idRaiz);
  if (!nodoRaiz) return;

  const ns    = "http://www.w3.org/2000/svg";
  const R     = 22;   // radio nodo
  const MADRE = 18;   // radio nodo madre (un poco más pequeño)
  const CELL  = 130;  // ancho mínimo por hoja (más espacio para ramificarse bien)
  const LVL   = 130;  // altura entre generaciones
  const PAD   = 80;

  const mk = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  // ─────────────────────────────────────────────────────────────
  // FASE 1: BFS para recopilar linaje principal
  // ─────────────────────────────────────────────────────────────
  const enLinaje   = new Set(); // nodos del linaje (descendientes del padre raíz)
  const esMadreExt = new Set(); // madres que vienen de fuera del linaje

  const colaBFS = [nodoRaiz];
  enLinaje.add(nodoRaiz.id);
  while (colaBFS.length > 0) {
    const actual = colaBFS.shift();
    const hijosIds = [...new Set(actual.hijos.map(h => h.id))];
    for (const hid of hijosIds) {
      const h = arbolGenealogico.nodos.get(hid);
      if (!h) continue;
      if (!enLinaje.has(h.id)) {
        enLinaje.add(h.id);
        colaBFS.push(h);
      }
      // Madre externa: si tiene madre que no está en el linaje
      if (h.madre && !enLinaje.has(h.madre.id)) {
        esMadreExt.add(h.madre.id);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // FASE 2: Layout del linaje principal
  // Cada "hoja" del árbol necesita espacio para su madre al lado
  // ─────────────────────────────────────────────────────────────
  const pos = new Map(); // id → {x, y}

  function hijosLinaje(nodo, visitados) {
    const vistos = new Set();
    return nodo.hijos
      .filter(h => {
        if (!h || !enLinaje.has(h.id) || visitados.has(h.id) || vistos.has(h.id)) return false;
        vistos.add(h.id);
        return true;
      })
      .map(h => arbolGenealogico.nodos.get(h.id))
      .filter(Boolean);
  }

  function contarHojas(nodo, visitados = new Set()) {
    if (!nodo || visitados.has(nodo.id)) return 1;
    visitados.add(nodo.id);
    const hijos = hijosLinaje(nodo, visitados);
    if (hijos.length === 0) return 1;
    return hijos.reduce((s, h) => s + contarHojas(h, visitados), 0);
  }

  function asignar(nodo, xMin, xMax, visitados = new Set()) {
    if (!nodo || visitados.has(nodo.id)) return;
    visitados.add(nodo.id);
    const xC = (xMin + xMax) / 2;
    // Usar generación real relativa a la raíz para el eje Y
    const nivelY = nodo.generacion - nodoRaiz.generacion;
    pos.set(nodo.id, { x: xC, y: PAD + nivelY * LVL });

    const hijos = hijosLinaje(nodo, new Set([...visitados]));
    if (hijos.length === 0) return;

    const total = hijos.reduce((s, h) => s + contarHojas(h, new Set([...visitados])), 0);
    let xCur = xMin;
    for (const hijo of hijos) {
      const hojas = contarHojas(hijo, new Set([...visitados]));
      const xNext = xCur + (xMax - xMin) * (hojas / total);
      asignar(hijo, xCur, xNext, new Set([...visitados]));
      xCur = xNext;
    }
  }

  // Calcular generación máxima real entre todos los nodos del linaje
  function genMax() {
    let max = nodoRaiz.generacion;
    for (const id of enLinaje) {
      const n = arbolGenealogico.nodos.get(id);
      if (n && n.generacion > max) max = n.generacion;
    }
    return max;
  }

  const totalHojas = contarHojas(nodoRaiz);
  const W = Math.max(600, totalHojas * CELL + PAD * 2);
  const profundidad = genMax() - nodoRaiz.generacion;
  const H = (profundidad + 1) * LVL + PAD * 2 + 50;

  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  asignar(nodoRaiz, PAD, W - PAD);

  // ─────────────────────────────────────────────────────────────
  // FASE 3: Posicionar madres externas JUNTO AL HIJO
  // La madre se pone a la derecha del hijo, en el mismo nivel Y
  // ─────────────────────────────────────────────────────────────
  // Mapa: madreId → lista de hijos que la tienen como madre
  const hijosDeEstaMadre = new Map();
  for (const id of enLinaje) {
    const nodo = arbolGenealogico.nodos.get(id);
    if (!nodo || !nodo.madre || !esMadreExt.has(nodo.madre.id)) continue;
    const mid = nodo.madre.id;
    if (!hijosDeEstaMadre.has(mid)) hijosDeEstaMadre.set(mid, []);
    hijosDeEstaMadre.get(mid).push(id);
  }

  // Para cada madre, posicionarla a la derecha de su primer hijo con posición disponible
  for (const [mid, hijos] of hijosDeEstaMadre) {
    // Usar el primer hijo que tenga posición
    const hijoConPos = hijos.find(hid => pos.has(hid));
    if (!hijoConPos) continue;
    const pH = pos.get(hijoConPos);
    // Offset a la derecha: R del hijo + gap + MADRE de la madre
    pos.set(mid, { x: pH.x + R + 16 + MADRE, y: pH.y });
  }

  // ─────────────────────────────────────────────────────────────
  // FASE 4: Dibujar conectores
  // ─────────────────────────────────────────────────────────────
  for (const id of enLinaje) {
    if (esMadreExt.has(id)) continue;
    const nodo = arbolGenealogico.nodos.get(id);
    if (!nodo || !pos.has(id)) continue;
    const pPadre = pos.get(id);

    const hijos = hijosLinaje(nodo, new Set())
      .filter(h => pos.has(h.id));
    if (hijos.length === 0) continue;

    // Barra horizontal conectando todos los hijos al mismo nivel
    const posHijos = hijos.map(h => pos.get(h.id));
    const xIzq = Math.min(...posHijos.map(p => p.x));
    const xDer = Math.max(...posHijos.map(p => p.x));
    const yArriba = posHijos[0].y - R;
    const yBajo   = pPadre.y + R;
    const yMedio  = yBajo + (yArriba - yBajo) * 0.45;

    // Vertical desde padre hasta el nivel de bifurcación
    svg.appendChild(mk("line", {
      x1: pPadre.x, y1: yBajo, x2: pPadre.x, y2: yMedio,
      stroke: "rgba(53,160,84,0.5)", "stroke-width": "1.5"
    }));

    // Horizontal conectando hijos (solo si hay más de uno)
    if (hijos.length > 1) {
      svg.appendChild(mk("line", {
        x1: xIzq, y1: yMedio, x2: xDer, y2: yMedio,
        stroke: "rgba(53,160,84,0.5)", "stroke-width": "1.5"
      }));
    }

    // Vertical desde bifurcación a cada hijo
    for (const hijo of hijos) {
      const pH = pos.get(hijo.id);
      svg.appendChild(mk("line", {
        x1: pH.x, y1: yMedio, x2: pH.x, y2: pH.y - R,
        stroke: "rgba(53,160,84,0.5)", "stroke-width": "1.5"
      }));

      // Si tiene madre externa: línea naranja punteada hijo ── madre
      if (hijo.madre && pos.has(hijo.madre.id)) {
        const pM = pos.get(hijo.madre.id);
        // Línea horizontal corta entre hijo y madre (a mitad de altura entre nodos)
        const yLink = pH.y; // mismo Y
        svg.appendChild(mk("line", {
          x1: pH.x + R, y1: yLink,
          x2: pM.x - MADRE, y2: yLink,
          stroke: "rgba(224,133,53,0.55)", "stroke-width": "1.5",
          "stroke-dasharray": "5,3"
        }));
        // Corazón entre los dos
        const xMid = (pH.x + R + pM.x - MADRE) / 2;
        const txt = mk("text", {
          x: xMid, y: yLink - 4,
          "text-anchor": "middle", "font-size": "9"
        });
        txt.textContent = "♥";
        txt.style.fill = "rgba(224,133,53,0.75)";
        svg.appendChild(txt);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // FASE 5: Dibujar nodos
  // ─────────────────────────────────────────────────────────────
  function dibujarNodo(id, radio, esMadre) {
    const nodo = arbolGenealogico.nodos.get(id);
    const p    = pos.get(id);
    if (!nodo || !p) return;

    const vivo        = diccionarioCriaturas.has(id);
    const esResaltado = id === idResaltado;
    const esRaiz      = id === idRaiz;

    const colorBorde = esResaltado ? "#f5aa64" : vivo ? "#35a054" : "#c03838";
    const colorFondo = esResaltado ? "rgba(245,170,100,0.20)"
      : vivo ? "rgba(11,22,16,0.95)" : "rgba(192,56,56,0.10)";

    const g = mk("g", { transform: `translate(${p.x},${p.y})` });
    g.style.cursor = "pointer";

    // Glow seleccionada
    if (esResaltado) {
      g.appendChild(mk("circle", { r: radio + 10, fill: "none", stroke: "rgba(245,170,100,0.22)", "stroke-width": "8" }));
      g.appendChild(mk("circle", { r: radio + 5,  fill: "rgba(245,170,100,0.10)" }));
    }

    // Anillo azul raíz de especie
    if (esRaiz && !esResaltado) {
      g.appendChild(mk("circle", {
        r: radio + 5, fill: "none",
        stroke: "rgba(91,159,212,0.40)", "stroke-width": "2.5",
        "stroke-dasharray": "4,3"
      }));
    }

    // Anillo naranja para madres externas
    if (esMadre) {
      g.appendChild(mk("circle", {
        r: radio + 4, fill: "none",
        stroke: "rgba(224,133,53,0.35)", "stroke-width": "2",
        "stroke-dasharray": "3,3"
      }));
    }

    // Círculo principal
    const circle = mk("circle", {
      r: radio, fill: colorFondo,
      stroke: colorBorde, "stroke-width": esResaltado ? "2.5" : "1.8"
    });
    g.appendChild(circle);

    // Sprite
    g.appendChild(mk("image", {
      href: getSrc(nodo.especie),
      x: -radio * 0.65, y: -radio * 0.85,
      width: radio * 1.3, height: radio * 1.3,
      preserveAspectRatio: "xMidYMid meet"
    }));

    // Etiqueta ♀ MADRE encima del nodo
    if (esMadre) {
      const t = mk("text", {
        "text-anchor": "middle", y: -(radio + 13),
        "font-size": "7", fill: "rgba(224,133,53,0.85)",
        "font-family": "JetBrains Mono,monospace", "font-weight": "600"
      });
      t.textContent = "♀ MADRE";
      g.appendChild(t);
    }

    // #ID debajo
    const txtId = mk("text", {
      "text-anchor": "middle", y: radio + 13,
      "font-size": esMadre ? "8" : "9", fill: colorBorde,
      "font-family": "JetBrains Mono,monospace"
    });
    txtId.textContent = `#${id}`;
    g.appendChild(txtId);

    // Generación arriba
    const label = esResaltado ? `★ G${nodo.generacion}`
      : esRaiz  ? `⬟ G${nodo.generacion}`
      : `G${nodo.generacion}`;
    const txtGen = mk("text", {
      "text-anchor": "middle", y: -(radio + (esMadre ? 5 : 6)),
      "font-size": esMadre ? "7" : "8",
      fill: esResaltado ? "#f5aa64" : esRaiz ? "#5b9fd4" : "#567060",
      "font-family": "JetBrains Mono,monospace",
      "font-weight": (esResaltado || esRaiz) ? "600" : "400"
    });
    txtGen.textContent = label;
    g.appendChild(txtGen);

    // Click
    g.addEventListener("click", () => {
      const c = diccionarioCriaturas.get(id);
      if (c) { criaturaSeleccionada = c; mostrarInformacion(c); cerrarArbolModal(); }
    });

    // Hover
    g.addEventListener("mouseenter", () => {
      circle.setAttribute("stroke-width", "3");
      circle.setAttribute("fill", vivo ? "rgba(74,201,110,0.14)" : "rgba(200,80,80,0.14)");
    });
    g.addEventListener("mouseleave", () => {
      circle.setAttribute("stroke-width", esResaltado ? "2.5" : "1.8");
      circle.setAttribute("fill", colorFondo);
    });

    svg.appendChild(g);
  }

  // Primero linaje principal, luego madres encima
  for (const id of enLinaje) {
    if (!esMadreExt.has(id)) dibujarNodo(id, R, false);
  }
  for (const id of esMadreExt) {
    if (pos.has(id)) dibujarNodo(id, MADRE, true);
  }
}

// ================================
// INICIO
// ================================
generarTerrenos();
inicializarGrafos();
poblar();
renderizar();
