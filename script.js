
"use strict";

// ==========================================
// 1. api config
// ==========================================

const API = "https://pogoapi.net/api/v1/";
const POKEAPI = "https://pokeapi.co/api/v2/";

const ARTWORK =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const suggestionsBox = document.getElementById("search-suggestions");
const randomBtn = document.getElementById("random-btn");
const statusMessage = document.getElementById("status");
const card = document.getElementById("pokemon-card");

const regularImage = document.getElementById("regular-image");
const shinyImage = document.getElementById("shiny-image");

const normalTab = document.getElementById("normal-tab");
const shadowTab = document.getElementById("shadow-tab");
const shadowStatus = document.getElementById("shadow-status");
const shadowInfo = document.getElementById("shadow-info");

const variantTabs = document.getElementById("variant-tabs");
const megaEnergyInfo = document.getElementById("mega-energy-info");

const pveTab = document.getElementById("pve-tab");
const pvpTab = document.getElementById("pvp-tab");
const movesContent = document.getElementById("moves-content");

const rankingsSection = document.getElementById("rankings-section");
const rankingsContent = document.getElementById("rankings-content");
const rankingsSource = document.getElementById("rankings-source");
const investmentContent = document.getElementById("investment-content");

let pokemonStats = [];
let pokemonTypes = [];
let pokemonMoves = [];
let shinyPokemon = {};
let shadowPokemon = null;
let megaPokemon = [];

let pokemonNames = [];
let currentPokemon = null;
let activeMega = null;
let activeVariant = "normal";
let activeMovesTab = "pve";

let artworkRequest = 0;
let megaLookupRequest = 0;

const artworkCache = new Map();
const megaFormCache = new Map();
const megaRequestCache = new Map();


// ==========================================
// 2. cp calc
// ==========================================

const CP_MULTIPLIERS = {
  20: 0.59740001,
  40: 0.79030001,
  50: 0.84030002
};

function getStats(pokemon) {
  const stats = pokemon?.stats || pokemon || {};

  const numberOrNaN = value =>
    value == null ? NaN : Number(value);

  return {
    attack: numberOrNaN(
      stats.base_attack ?? stats.attack
    ),
    defense: numberOrNaN(
      stats.base_defense ?? stats.defense
    ),
    stamina: numberOrNaN(
      stats.base_stamina ?? stats.stamina
    )
  };
}

function calculateCP(pokemon, level) {
  const stats = getStats(pokemon);

  if (
    !Number.isFinite(stats.attack) ||
    !Number.isFinite(stats.defense) ||
    !Number.isFinite(stats.stamina)
  ) {
    return null;
  }

  const attack = stats.attack + 15;
  const defense = stats.defense + 15;
  const stamina = stats.stamina + 15;

  const multiplier = CP_MULTIPLIERS[level];

  return Math.max(
    10,
    Math.floor(
      attack *
      Math.sqrt(defense) *
      Math.sqrt(stamina) *
      multiplier * multiplier / 10
    )
  );
}

function displayCP(pokemon) {
  [20, 40, 50].forEach(level => {
    const element = document.getElementById(`cp-${level}`);
    const cp = calculateCP(pokemon, level);

    element.textContent =
      cp === null ? "N/A" : cp.toLocaleString();
  });
}


// ==========================================
// 3. moveset recs
// ==========================================

// examples only, not live rankings

const MOVE_RECOMMENDATIONS = {
  445: {
    pve: {
      title: "Garchomp — Ground Raid Attacker",
      fast: "Mud Shot",
      charged: ["Earth Power"],
      note:
        "Earth Power may require an Elite Charged TM."
    },
    pvp: {
      title: "Garchomp — Master League",
      fast: "Dragon Tail",
      charged: ["Earth Power", "Outrage"],
      note:
        "Example build. Check current PvP rankings before investing."
    }
  },

  643: {
    pve: {
      title: "Reshiram — Fire Raid Attacker",
      fast: "Fire Fang",
      charged: ["Fusion Flare"],
      note:
        "Fusion Flare is a special move and may require an Elite Charged TM."
    },
    pvp: {
      title: "Reshiram — Master League",
      fast: "Dragon Breath",
      charged: ["Fusion Flare", "Draco Meteor"],
      note:
        "Illustrative Master League build."
    }
  },

  384: {
    pve: {
      title: "Rayquaza — Dragon Raid Attacker",
      fast: "Dragon Tail",
      charged: ["Breaking Swipe"],
      note:
        "Compare Breaking Swipe and Outrage for raids."
    },
    pvp: {
      title: "Rayquaza — Master League",
      fast: "Dragon Tail",
      charged: ["Breaking Swipe", "Dragon Ascent"],
      note:
        "Illustrative build. Check move availability."
    }
  },

  609: {
    pve: {
      title: "Chandelure — Ghost Raid Attacker",
      fast: "Hex",
      charged: ["Shadow Ball"],
      note:
        "Fire Spin and Overheat provide a Fire-type alternative."
    },
    pvp: {
      title: "Chandelure — GO Battle League",
      fast: "Incinerate",
      charged: ["Shadow Ball", "Flame Charge"],
      note:
        "Illustrative PvP build."
    }
  }
};


// ==========================================
// 4. api helpers
// ==========================================

async function fetchJSON(file) {
  const response = await fetch(API + file);

  if (!response.ok) {
    throw new Error(`${file} failed: ${response.status}`);
  }

  return response.json();
}

async function fetchOptional(file) {
  try {
    return await fetchJSON(file);
  } catch (error) {
    console.warn(`${file} unavailable:`, error);
    return null;
  }
}

function toEntries(data) {
  if (Array.isArray(data)) return data;

  if (!data || typeof data !== "object") {
    return [];
  }

  return Object.values(data).flatMap(value => {
    if (Array.isArray(value)) return value;

    if (!value || typeof value !== "object") {
      return [];
    }

    if (
      value.pokemon_id != null ||
      value.pokemon_name != null
    ) {
      return [value];
    }

    return Object.values(value).filter(
      item => item && typeof item === "object"
    );
  });
}

function findMatching(data, pokemon) {
  const matches = toEntries(data).filter(
    item =>
      Number(item.pokemon_id) ===
      Number(pokemon.pokemon_id)
  );

  return (
    matches.find(item => item.form === pokemon.form) ||
    matches.find(item => item.form === "Normal") ||
    matches[0] ||
    null
  );
}


// ==========================================
// 5. loading da api
// ==========================================

async function loadData() {
  statusMessage.textContent = "Loading Pokémon data...";
  randomBtn.disabled = true;

  try {
    const [stats, types, shiny, moves] =
      await Promise.all([
        fetchJSON("pokemon_stats.json"),
        fetchJSON("pokemon_types.json"),
        fetchJSON("shiny_pokemon.json"),
        fetchJSON("current_pokemon_moves.json")
      ]);

    pokemonStats = toEntries(stats);
    pokemonTypes = types;
    shinyPokemon = shiny;
    pokemonMoves = moves;

    buildSearchIndex();

    randomBtn.disabled = false;
    statusMessage.textContent = "";

    findPokemon("Pikachu");

    // optional datasets load separately

    const [shadow, mega] = await Promise.all([
      fetchOptional("shadow_pokemon.json"),
      fetchOptional("mega_pokemon.json")
    ]);

    shadowPokemon = shadow;
    megaPokemon = normalizeMegaData(mega);

    // refresh mega data after pogoapi finishes loading

    megaFormCache.clear();

    if (currentPokemon) {
      displayVariantControls(currentPokemon);
      displayMegaControls(currentPokemon);
    }

  } catch (error) {
    console.error("API error:", error);

    statusMessage.textContent =
      "Unable to load Pokémon data. Please refresh the page.";
  }
}


// ==========================================
// 6. auto complete and spell check
// ==========================================

function buildSearchIndex() {
  pokemonNames = [...new Set(
    pokemonStats
      .map(pokemon => pokemon.pokemon_name)
      .filter(Boolean)
  )].sort();
}

function spellingDistance(a, b) {
  const previous = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  );

  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const old = previous[j];

      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );

      diagonal = old;
    }
  }

  return previous[b.length];
}

function getSuggestions(query) {
  const search = query.trim().toLowerCase();

  if (!search) return [];

  const prefixes = pokemonNames.filter(name =>
    name.toLowerCase().startsWith(search)
  );

  const contains = pokemonNames.filter(name =>
    name.toLowerCase().includes(search) &&
    !prefixes.includes(name)
  );

  const matches = [...prefixes, ...contains];

  if (matches.length) {
    return matches.slice(0, 6);
  }

  if (search.length < 3) return [];

  const maxDistance = search.length >= 7 ? 3 : 2;

  return pokemonNames
    .map(name => ({
      name,
      distance: spellingDistance(
        search,
        name.toLowerCase()
      )
    }))
    .filter(item => item.distance <= maxDistance)
    .sort((a, b) =>
      a.distance - b.distance ||
      a.name.localeCompare(b.name)
    )
    .slice(0, 5)
    .map(item => item.name);
}

function showSuggestions() {
  const suggestions = getSuggestions(searchInput.value);

  suggestionsBox.replaceChildren();

  if (!suggestions.length) {
    suggestionsBox.hidden = true;
    return;
  }

  suggestions.forEach(name => {
    const option = document.createElement("button");

    option.type = "button";
    option.className = "suggestion-item";
    option.setAttribute("role", "option");
    option.textContent = name;

    option.addEventListener("click", () => {
      searchInput.value = name;
      suggestionsBox.hidden = true;
      findPokemon(name);
    });

    suggestionsBox.appendChild(option);
  });

  suggestionsBox.hidden = false;
}


// ==========================================
// 7. finding the poke
// ==========================================

function findPokemon(search) {
  const query = String(search).trim().toLowerCase();

  const matches = pokemonStats.filter(pokemon =>
    pokemon.pokemon_name?.toLowerCase() === query ||
    String(pokemon.pokemon_id) === query
  );

  const pokemon =
    matches.find(item => item.form === "Normal") ||
    matches[0];

  if (!pokemon) {
    card.hidden = true;
    statusMessage.textContent =
      "Pokémon not found. Try another name or number.";
    return;
  }

  currentPokemon = pokemon;
  activeMega = null;
  activeVariant = "normal";

  searchInput.value = pokemon.pokemon_name;
  statusMessage.textContent = "";

  displayPokemon();
}


// ==========================================
// 8. display info
// ==========================================

function displayPokemon() {
  if (!currentPokemon) return;

  card.hidden = false;

  const id = Number(currentPokemon.pokemon_id);

  document.getElementById("pokemon-number").textContent =
    "#" + String(id).padStart(4, "0");

  displayShinyStatus(currentPokemon);
  displayActiveForm();
}

function displayActiveForm() {
  if (!currentPokemon) return;

  const pokemon = activeMega || currentPokemon;

  document.getElementById("pokemon-name").textContent =
    activeMega
      ? activeMega.mega_name
      : currentPokemon.pokemon_name;

  if (activeMega?.source === "pokeapi") {
    [20, 40, 50].forEach(level => {
      document.getElementById(`cp-${level}`).textContent =
        "N/A";
    });

    document.getElementById("pokemon-stats").textContent =
      "Pokémon GO base stats are unavailable for this form.";

    displayTypeBadges(activeMega.type);

  } else {
    displayCP(pokemon);
    displayStats(pokemon);

    if (activeMega) {
      displayTypeBadges(activeMega.type);
    } else {
      displayTypes(currentPokemon);
    }
  }

  if (activeMega) {
    updateMegaArtwork(activeMega);
  } else {
    updateArtwork(currentPokemon);
  }

  displayVariantControls(currentPokemon);
  displayMegaControls(currentPokemon);

  displayMoves(currentPokemon);
  displayRankings();
  displayInvestment();
}


// ==========================================
// 9. type badges
// ==========================================

function getTypeColor(type) {
  const colors = {
    Normal: "#929da3",
    Fire: "#f5a04b",
    Water: "#539bd1",
    Electric: "#f3d34a",
    Grass: "#60b875",
    Ice: "#76cfc6",
    Fighting: "#ce5964",
    Poison: "#a56ac2",
    Ground: "#d99a62",
    Flying: "#8ca9d6",
    Psychic: "#ee8194",
    Bug: "#91b54a",
    Rock: "#b5a16a",
    Ghost: "#6575ad",
    Dragon: "#5274c7",
    Dark: "#655d68",
    Steel: "#5e9cad",
    Fairy: "#d991ca"
  };

  return colors[type] || "#888888";
}

function displayTypeBadges(types) {
  const container =
    document.getElementById("pokemon-types");

  container.replaceChildren();

  if (!Array.isArray(types) || !types.length) {
    container.textContent = "Type unavailable";
    return;
  }

  types.forEach(type => {
    const badge = document.createElement("span");

    badge.className = "type-badge";
    badge.textContent = type;
    badge.style.backgroundColor = getTypeColor(type);

    container.appendChild(badge);
  });
}

function displayTypes(pokemon) {
  const data = findMatching(pokemonTypes, pokemon);
  displayTypeBadges(data?.type);
}


// ==========================================
// 10. stats
// ==========================================

function displayStats(pokemon) {
  const container =
    document.getElementById("pokemon-stats");

  container.replaceChildren();

  const data = getStats(pokemon);

  const stats = [
    ["Attack", data.attack],
    ["Defence", data.defense],
    ["Stamina", data.stamina]
  ];

  stats.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "stat-row";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;

    const valueSpan = document.createElement("strong");
    valueSpan.textContent =
      Number.isFinite(value) ? value : "N/A";

    row.append(labelSpan, valueSpan);

    const bar = document.createElement("div");
    bar.className = "stat-bar";

    const fill = document.createElement("div");
    fill.className = "stat-fill";

    fill.style.width = Number.isFinite(value)
      ? `${Math.min(value / 350 * 100, 100)}%`
      : "0%";

    bar.appendChild(fill);
    container.append(row, bar);
  });
}


// ==========================================
// 11. pokemon images
// ==========================================

function setImage(element, url, label, request) {
  element.onload = null;
  element.onerror = null;

  element.style.visibility = "hidden";
  element.alt = label;
  element.removeAttribute("src");

  if (!url) return;

  element.onload = () => {
    if (request !== artworkRequest) return;
    element.style.visibility = "visible";
  };

  element.onerror = () => {
    if (request !== artworkRequest) return;

    element.style.visibility = "hidden";
    console.warn("Artwork unavailable:", url);
  };

  element.src = url;
}

function setArtworkLabels(first, second, shadow = false) {
  document.querySelectorAll(".pokemon-form").forEach(
    (form, index) => {
      form.classList.toggle("shadow-form", shadow);

      const label = form.querySelector("p");

      if (label) {
        label.textContent =
          index === 0 ? first : second;
      }
    }
  );
}

function updateArtwork(pokemon) {
  const request = ++artworkRequest;

  const id = Number(pokemon.pokemon_id);
  const name = pokemon.pokemon_name;
  const shadow = activeVariant === "shadow";

  setArtworkLabels(
    shadow ? "Shadow Regular" : "Regular",
    shadow ? "Shadow Shiny" : "Shiny",
    shadow
  );

  setImage(
    regularImage,
    `${ARTWORK}${id}.png`,
    shadow ? `Shadow ${name}` : `Regular ${name}`,
    request
  );

  setImage(
    shinyImage,
    `${ARTWORK}shiny/${id}.png`,
    shadow ? `Shiny Shadow ${name}` : `Shiny ${name}`,
    request
  );
}


// ==========================================
// 12. can it be shiny
// ==========================================

function displayShinyStatus(pokemon) {
  const element =
    document.getElementById("shiny-status");

  const id = Number(pokemon.pokemon_id);

  const data =
    shinyPokemon?.[id] ||
    shinyPokemon?.[String(id)];

  if (!data) {
    element.textContent =
      "Shiny availability not confirmed by this dataset.";
    return;
  }

  const formData =
    data?.[pokemon.form] ||
    data?.Normal ||
    data;

  const available = [
    "found_wild",
    "found_raid",
    "found_egg",
    "found_research",
    "found_evolution"
  ].some(key => formData?.[key] === true);

  element.textContent = available
    ? "Shiny availability recorded in Pokémon GO."
    : "Shiny release status is not confirmed for this form.";
}


// ==========================================
// 13. shadow poke
// ==========================================

function hasShadowForm(pokemon) {
  if (!shadowPokemon) return false;

  const id = Number(pokemon.pokemon_id);

  if (Array.isArray(shadowPokemon)) {
    return shadowPokemon.some(item =>
      Number(item.pokemon_id) === id
    );
  }

  const entry =
    shadowPokemon[id] ||
    shadowPokemon[String(id)] ||
    shadowPokemon[pokemon.pokemon_name];

  if (!entry) return false;

  if (typeof entry === "boolean") return entry;

  if (Array.isArray(entry)) {
    return entry.length > 0;
  }

  if (typeof entry === "object") {
    return entry.is_shadow !== false &&
      entry.shadow !== false;
  }

  return Boolean(entry);
}

function displayVariantControls(pokemon) {
  const available = hasShadowForm(pokemon);

  const normalSelected =
    activeVariant === "normal" && !activeMega;

  const shadowSelected =
    activeVariant === "shadow" && !activeMega;

  normalTab.classList.toggle("active", normalSelected);
  shadowTab.classList.toggle("active", shadowSelected);

  normalTab.setAttribute(
    "aria-pressed",
    String(normalSelected)
  );

  shadowTab.setAttribute(
    "aria-pressed",
    String(shadowSelected)
  );

  shadowTab.disabled = !available;

  if (!shadowPokemon) {
    shadowStatus.textContent =
      "Shadow availability data unavailable.";
  } else if (available) {
    shadowStatus.textContent =
      "Shadow variant available.";
  } else {
    shadowStatus.textContent =
      "No Shadow variant listed.";
  }

  shadowInfo.hidden = !shadowSelected;
}

function switchVariant(variant) {
  if (!currentPokemon) return;

  if (
    variant === "shadow" &&
    !hasShadowForm(currentPokemon)
  ) {
    return;
  }

  activeMega = null;
  activeVariant = variant;

  displayActiveForm();
}


// ==========================================
// 14. mega and primal data
// ==========================================

// read pogoapi mega forms, including grouped records

function normalizeMegaData(data) {
  if (!data) return [];

  const results = [];

  function addForm(item, parent = {}, formKey = "") {
    if (!item || typeof item !== "object") return;

    const id = Number(
      item.pokemon_id ?? parent.pokemon_id
    );

    const baseName =
      item.pokemon_name ??
      parent.pokemon_name ??
      "";

    const form =
      item.mega_name ??
      item.mega_form ??
      item.form ??
      formKey;

    if (!Number.isFinite(id) || !form) return;

    const name = String(form);

    const displayName =
      name.toLowerCase().includes(
        String(baseName).toLowerCase()
      ) && baseName
        ? name
        : name.toLowerCase().includes("primal")
          ? `Primal ${baseName}`
          : name.toLowerCase().includes("mega")
            ? `${baseName} ${name}`
            : `Mega ${baseName} ${name}`;

    results.push({
      pokemon_id: id,
      pokemon_name: baseName,
      mega_name: displayName.trim(),
      type: item.type ?? parent.type ?? [],
      stats: item.stats ?? {
        base_attack: item.base_attack,
        base_defense: item.base_defense,
        base_stamina: item.base_stamina
      },
      first_time_mega_energy_required:
        item.first_time_mega_energy_required ??
        parent.first_time_mega_energy_required,
      mega_energy_required:
        item.mega_energy_required ??
        parent.mega_energy_required,
      source: "pogoapi"
    });
  }

  function process(item, parent = {}, formKey = "") {
    if (!item || typeof item !== "object") return;

    if (Array.isArray(item)) {
      item.forEach(value => process(value, parent));
      return;
    }

    const merged = { ...parent, ...item };

    const evolutions =
      item.mega_evolutions ??
      item.mega_forms;

    if (evolutions) {
      if (Array.isArray(evolutions)) {
        evolutions.forEach(value =>
          process(value, merged)
        );
      } else {
        Object.entries(evolutions).forEach(
          ([name, value]) => {
            process(value, merged, name);
          }
        );
      }

      return;
    }

    if (
      item.mega_name ||
      item.mega_form ||
      item.form ||
      formKey
    ) {
      addForm(item, parent, formKey);
    }
  }

  if (Array.isArray(data)) {
    data.forEach(item => process(item));
  } else {
    Object.entries(data).forEach(([id, value]) => {
      process(value, { pokemon_id: Number(id) });
    });
  }

  return results.filter((mega, index, array) =>
    array.findIndex(item =>
      item.pokemon_id === mega.pokemon_id &&
      item.mega_name === mega.mega_name
    ) === index
  );
}


// ==========================================
// 15. extra mega forms from pokeapi
// ==========================================

function getMegaLabel(name) {
  if (name.includes("-primal")) return "Primal";
  if (name.endsWith("-mega-x")) return "Mega X";
  if (name.endsWith("-mega-y")) return "Mega Y";
  if (name.endsWith("-mega-z")) return "Mega Z";

  return "Mega";
}

function getMegaDisplayName(baseName, name) {
  const label = getMegaLabel(name);

  if (label === "Primal") {
    return `Primal ${baseName}`;
  }

  if (label === "Mega X") {
    return `Mega ${baseName} X`;
  }

  if (label === "Mega Y") {
    return `Mega ${baseName} Y`;
  }

  if (label === "Mega Z") {
    return `Mega ${baseName} Z`;
  }

  return `Mega ${baseName}`;
}

function normaliseName(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getMegaSpriteName(mega) {
  if (mega.sprite_name) {
    return mega.sprite_name;
  }

  const name = normaliseName(mega.mega_name);
  const base = normaliseName(mega.pokemon_name);

  if (name.includes("primal")) {
    return `${base}-primal`;
  }

  if (name.endsWith("-x")) {
    return `${base}-mega-x`;
  }

  if (name.endsWith("-y")) {
    return `${base}-mega-y`;
  }

  if (name.endsWith("-z")) {
    return `${base}-mega-z`;
  }

  return `${base}-mega`;
}

// automatically retrieve additional mega forms
// and their typing from pokeapi

async function loadMegaForms(pokemon) {
  const id = Number(pokemon.pokemon_id);

  if (megaFormCache.has(id)) {
    return megaFormCache.get(id);
  }

  if (megaRequestCache.has(id)) {
    return megaRequestCache.get(id);
  }

  const request = (async () => {
    const forms = megaPokemon
      .filter(item => item.pokemon_id === id)
      .map(item => ({ ...item }));

    try {
      const response = await fetch(
        `${POKEAPI}pokemon-species/${id}/`
      );

      if (!response.ok) {
        throw new Error("Species data unavailable");
      }

      const species = await response.json();

      const varieties = species.varieties.filter(item =>
        /-mega(?:-[a-z])?$|-primal$/.test(
          item.pokemon.name
        )
      );

      for (const variety of varieties) {
        const name = variety.pokemon.name;

        // retrieve this form's typing
        // and artwork from its own pokemon record

        let formTypes = [];

        try {
          const formResponse = await fetch(
            variety.pokemon.url
          );

          if (formResponse.ok) {
            const formData = await formResponse.json();

            formTypes = formData.types
              .sort((a, b) => a.slot - b.slot)
              .map(item => {
                const type = item.type.name;

                return (
                  type.charAt(0).toUpperCase() +
                  type.slice(1)
                );
              });
          }
        } catch (error) {
          console.warn(
            "Mega typing unavailable:",
            error
          );
        }

        const existing = forms.find(item =>
          getMegaSpriteName(item) === name
        );

        if (existing) {
          // fill missing typing for pogoapi forms

          if (
            !Array.isArray(existing.type) ||
            !existing.type.length
          ) {
            existing.type = formTypes;
          }

          existing.sprite_name = name;
          continue;
        }

        // pokeapi-only forms have no pogo stats

        forms.push({
          pokemon_id: id,
          pokemon_name: pokemon.pokemon_name,
          mega_name: getMegaDisplayName(
            pokemon.pokemon_name,
            name
          ),
          sprite_name: name,
          source: "pokeapi",
          stats: null,
          type: formTypes,
          first_time_mega_energy_required: null,
          mega_energy_required: null
        });
      }

    } catch (error) {
      console.warn(
        "Additional Mega forms unavailable:",
        error
      );
    }

    megaFormCache.set(id, forms);

    return forms;
  })();

  megaRequestCache.set(id, request);

  try {
    return await request;
  } finally {
    megaRequestCache.delete(id);
  }
}


// ==========================================
// 16. mega and primal tabs
// ==========================================

async function displayMegaControls(pokemon) {
  const request = ++megaLookupRequest;

  variantTabs.querySelectorAll(".mega-tab").forEach(
    button => button.remove()
  );

  // show energy even while buttons load

  displayMegaEnergy();

  const forms = await loadMegaForms(pokemon);

  if (
    request !== megaLookupRequest ||
    currentPokemon !== pokemon
  ) {
    return;
  }

  forms.forEach(mega => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "variant-tab mega-tab";
    button.textContent = mega.mega_name;

    const selected = activeMega === mega;

    button.classList.toggle("active", selected);

    button.setAttribute(
      "aria-pressed",
      String(selected)
    );

    button.addEventListener("click", () => {
      activeMega = mega;
      activeVariant = "normal";

      displayActiveForm();
    });

    variantTabs.appendChild(button);
  });

  displayMegaEnergy();
}

function displayMegaEnergy() {
  if (!megaEnergyInfo) return;

  megaEnergyInfo.replaceChildren();

  if (!activeMega) {
    megaEnergyInfo.hidden = true;
    return;
  }

  megaEnergyInfo.hidden = false;

  const heading = document.createElement("h4");
  heading.textContent = "Mega / Primal Information";

  megaEnergyInfo.appendChild(heading);

  if (activeMega.source === "pokeapi") {
    const note = document.createElement("p");

    note.textContent =
      "This form is listed in PokéAPI. Pokémon GO " +
      "stats, CP, and Mega Energy are unavailable " +
      "from the connected dataset.";

    megaEnergyInfo.appendChild(note);
    return;
  }

  const first =
    activeMega.first_time_mega_energy_required;

  const repeat =
    activeMega.mega_energy_required;

  if (first != null) {
    const paragraph = document.createElement("p");

    paragraph.textContent =
      `First evolution: ${first} Mega Energy`;

    megaEnergyInfo.appendChild(paragraph);
  }

  if (repeat != null) {
    const paragraph = document.createElement("p");

    paragraph.textContent =
      `Subsequent evolution: ${repeat} Mega Energy`;

    megaEnergyInfo.appendChild(paragraph);
  }

  if (first == null && repeat == null) {
    const paragraph = document.createElement("p");

    paragraph.textContent =
      "Mega Energy requirements unavailable.";

    megaEnergyInfo.appendChild(paragraph);
  }
}


// ==========================================
// 17. mega and primal artwork
// ==========================================

async function getMegaArtwork(mega) {
  const spriteName = getMegaSpriteName(mega);

  if (artworkCache.has(spriteName)) {
    return artworkCache.get(spriteName);
  }

  const response = await fetch(
    `${POKEAPI}pokemon/${spriteName}/`
  );

  if (!response.ok) {
    throw new Error(
      `Artwork not found for ${spriteName}`
    );
  }

  const data = await response.json();

  const artwork =
    data.sprites?.other?.["official-artwork"];

  const result = {
    regular: artwork?.front_default || null,
    shiny: artwork?.front_shiny || null
  };

  artworkCache.set(spriteName, result);

  return result;
}

async function updateMegaArtwork(mega) {
  const request = ++artworkRequest;

  setArtworkLabels(
    "Mega / Primal",
    "Shiny Mega / Primal"
  );

  regularImage.style.visibility = "hidden";
  shinyImage.style.visibility = "hidden";

  regularImage.removeAttribute("src");
  shinyImage.removeAttribute("src");

  try {
    const artwork = await getMegaArtwork(mega);

    if (
      request !== artworkRequest ||
      activeMega !== mega
    ) {
      return;
    }

    setImage(
      regularImage,
      artwork.regular,
      mega.mega_name,
      request
    );

    setImage(
      shinyImage,
      artwork.shiny,
      `Shiny ${mega.mega_name}`,
      request
    );

  } catch (error) {
    if (request !== artworkRequest) return;

    console.warn(
      "Mega artwork unavailable:",
      error
    );
  }
}


// ==========================================
// 18. poke moves
// ==========================================

function addMoveRow(container, label, value) {
  const row = document.createElement("div");
  row.className = "move-row";

  const labelElement = document.createElement("span");
  labelElement.textContent = label;

  const valueElement = document.createElement("strong");
  valueElement.textContent = value;

  row.append(labelElement, valueElement);
  container.appendChild(row);
}

function getMoveData(pokemon) {
  const id = Number(pokemon.pokemon_id);

  if (Array.isArray(pokemonMoves)) {
    return findMatching(pokemonMoves, pokemon);
  }

  const entry =
    pokemonMoves?.[id] ??
    pokemonMoves?.[String(id)] ??
    pokemonMoves?.[pokemon.pokemon_name];

  if (!entry) {
    return findMatching(pokemonMoves, pokemon);
  }

  if (Array.isArray(entry)) {
    return (
      entry.find(item => item.form === pokemon.form) ||
      entry.find(item => item.form === "Normal") ||
      entry[0] ||
      null
    );
  }

  if (entry.fast_moves || entry.charged_moves) {
    return entry;
  }

  return (
    entry[pokemon.form] ||
    entry.Normal ||
    null
  );
}

function moveList(value) {
  return Array.isArray(value)
    ? value.join(", ") || "N/A"
    : "N/A";
}

function displayMoves(pokemon) {
  movesContent.replaceChildren();

  const moves = getMoveData(pokemon);
  const id = Number(pokemon.pokemon_id);

  const recommendation =
    pokemon.form === "Normal"
      ? MOVE_RECOMMENDATIONS[id]?.[activeMovesTab]
      : null;

  if (recommendation) {
    const heading = document.createElement("h4");

    heading.textContent =
      activeMega
        ? `${activeMega.mega_name} — Example Moveset`
        : activeVariant === "shadow"
          ? `Shadow ${recommendation.title}`
          : recommendation.title;

    movesContent.appendChild(heading);

    addMoveRow(
      movesContent,
      "Fast Move",
      recommendation.fast
    );

    recommendation.charged.forEach((move, index) => {
      addMoveRow(
        movesContent,
        `Charged Move ${index + 1}`,
        move
      );
    });

    const note = document.createElement("p");
    note.className = "move-note";

    note.textContent = activeMega
      ? "This is a species-based example, not a verified Mega-specific ranking. " +
        recommendation.note
      : recommendation.note;

    movesContent.appendChild(note);

  } else {
    const note = document.createElement("p");
    note.className = "move-note";

    note.textContent =
      "No curated recommendation is available. " +
      "Check the available moves below.";

    movesContent.appendChild(note);
  }

  if (activeVariant === "shadow") {
    const warning = document.createElement("p");
    warning.className = "move-note";

    warning.textContent =
      "Shadow Pokémon generally require a special event " +
      "to remove Frustration using a Charged TM.";

    movesContent.appendChild(warning);
  }

  const heading = document.createElement("h4");
  heading.textContent = "Available Moves";

  movesContent.appendChild(heading);

  if (!moves) {
    const note = document.createElement("p");

    note.textContent =
      "Move data unavailable for this Pokémon.";

    movesContent.appendChild(note);
    return;
  }

  addMoveRow(
    movesContent,
    "Fast Moves",
    moveList(moves.fast_moves)
  );

  addMoveRow(
    movesContent,
    "Charged Moves",
    moveList(moves.charged_moves)
  );

  if (moves.elite_fast_moves?.length) {
    addMoveRow(
      movesContent,
      "Elite Fast Moves",
      moveList(moves.elite_fast_moves)
    );
  }

  if (moves.elite_charged_moves?.length) {
    addMoveRow(
      movesContent,
      "Elite Charged Moves",
      moveList(moves.elite_charged_moves)
    );
  }
}


// ==========================================
// 19. rankings
// ==========================================

// no verified rankings connected yet

function displayRankings() {
  rankingsContent.replaceChildren();
  rankingsSection.hidden = true;
  rankingsSource.textContent = "";
}


// ==========================================
// 20. investment info
// ==========================================

function displayInvestment() {
  investmentContent.replaceChildren();

  const intro = document.createElement("p");

  if (activeMega) {
    intro.textContent =
      "Mega and Primal Pokémon can have increased base stats. " +
      "Consider their raid role, Mega Energy, and available moves.";
  } else if (activeVariant === "shadow") {
    intro.textContent =
      "Shadow Pokémon deal 20% more damage but take 20% more damage. " +
      "Consider their raid role and Frustration restrictions.";
  } else {
    intro.textContent =
      "Consider this Pokémon's battle role and moves " +
      "before spending Stardust or Candy XL.";
  }

  const note = document.createElement("p");

  note.textContent =
    "Powering up beyond level 40 requires Candy XL. " +
    "Certain special moves may require Elite TMs.";

  investmentContent.append(intro, note);
}


// ==========================================
// 21. pvp pve tabs
// ==========================================

function switchMovesTab(tab) {
  activeMovesTab = tab;

  pveTab.classList.toggle("active", tab === "pve");
  pvpTab.classList.toggle("active", tab === "pvp");

  if (currentPokemon) {
    displayMoves(currentPokemon);
    displayRankings();
    displayInvestment();
  }
}

pveTab.addEventListener("click", () => {
  switchMovesTab("pve");
});

pvpTab.addEventListener("click", () => {
  switchMovesTab("pvp");
});


// ==========================================
// 22. normal shadow tabs
// ==========================================

normalTab.addEventListener("click", () => {
  switchVariant("normal");
});

shadowTab.addEventListener("click", () => {
  switchVariant("shadow");
});


// ==========================================
// 23. searching poke
// ==========================================

searchInput.addEventListener("input", showSuggestions);

searchInput.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    suggestionsBox.hidden = true;
  }
});

document.addEventListener("click", event => {
  if (!event.target.closest(".search-wrapper")) {
    suggestionsBox.hidden = true;
  }
});

searchForm.addEventListener("submit", event => {
  event.preventDefault();

  suggestionsBox.hidden = true;
  findPokemon(searchInput.value);
});


// ==========================================
// 24. rng poke
// ==========================================

randomBtn.addEventListener("click", () => {
  const normalForms = pokemonStats.filter(
    pokemon => pokemon.form === "Normal"
  );

  const choices = normalForms.length
    ? normalForms
    : pokemonStats;

  if (!choices.length) return;

  const random = choices[
    Math.floor(Math.random() * choices.length)
  ];

  findPokemon(String(random.pokemon_id));
});


// ==========================================
// 25. start this mf
// ==========================================

loadData();
