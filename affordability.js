const AGE_BASELINE = {
  under30: ["Under 30", 3],
  "31-35": ["31–35", 5],
  "36-40": ["36–40", 8],
  "41-45": ["41–45", 10],
  "46plus": ["46+", 14],
};

const INDUSTRY_SHIFT = {
  tech: ["Tech/Internet", 3],
  government: ["Government/Stable", -2],
  traditional: ["Traditional", 0],
  healthcare: ["Healthcare", -1],
};

function expectedSearchMonths(age, industry) {
  const ageRow = AGE_BASELINE[age];
  const industryRow = INDUSTRY_SHIFT[industry];
  if (!ageRow || !industryRow) return null;
  return Math.max(1, ageRow[1] + industryRow[1]);
}

const QUICK_LIVING = 2000;

function assessAffordability(input) {
  const searchMonths = expectedSearchMonths(input.age, input.industry);
  if (searchMonths == null) return { error: "choice" };
  if (!Number.isFinite(input.income) || input.income <= 0) return { error: "income" };
  const quick = input.mode !== "detailed";
  const living = quick ? QUICK_LIVING : input.living;
  if (!quick && (!Number.isFinite(living) || living < 0)) return { error: "living" };
  const spouse = quick || !(input.spouse > 0) ? 0 : input.spouse;
  const severance = quick || !(input.severance > 0) ? 0 : input.severance;
  const dual = spouse > 0;
  const burn = dual ? input.piti + living - spouse : input.piti + living;
  let unlimited = false;
  let runway = null;
  if (!(burn > 0)) {
    unlimited = true;
  } else {
    runway = (input.savings + severance) / burn;
    if (!Number.isFinite(runway)) return { error: "burn" };
  }
  const dti = (input.piti / input.income) * 100;
  if (!Number.isFinite(dti)) return { error: "income" };
  const runwayShown = unlimited ? null : Math.round(runway * 10) / 10;
  const dtiShown = Math.round(dti * 10) / 10;
  let level = "safe";
  if (!unlimited) {
    if (runwayShown < searchMonths) level = "danger";
    else if (runwayShown > 12) level = "safe";
    else level = "watch";
  }
  const cushion = (input.savings + severance) / searchMonths - living + spouse;
  const cap = input.income * 0.36;
  if (!Number.isFinite(cushion) || !Number.isFinite(cap)) return { error: "burn" };
  const safePayment = Math.max(0, Math.min(cushion, cap));
  let dtiBand = "ok";
  if (dtiShown > 43) dtiBand = "high";
  else if (dtiShown > 36) dtiBand = "elevated";
  return {
    age: input.age,
    industry: input.industry,
    children: quick ? null : input.children,
    estimatedLiving: quick,
    living,
    searchMonths,
    burn,
    unlimited,
    runwayShown,
    dtiShown,
    dtiBand,
    level,
    safePayment,
    cushion,
    cap,
    dual,
  };
}

function formatMonthCount(value) {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text + (rounded === 1 ? " month" : " months");
}

function searchNote(age, industry, months) {
  const [ageLabel, base] = AGE_BASELINE[age];
  const [industryLabel, shift] = INDUSTRY_SHIFT[industry];
  let note = ageLabel + " baseline " + base + " mo.";
  if (shift > 0) note += " " + industryLabel + " +" + shift + " mo.";
  else if (shift < 0) note += " " + industryLabel + " " + shift + " mo.";
  else note += " " + industryLabel + " no change.";
  if (months !== base + shift) note += " Floor 1 mo.";
  return note;
}

function adviceSentence(months, payment) {
  const article = months === 8 || months === 11 || months === 18 ? "an" : "a";
  return "To survive " + article + " " + months + "-month job search and keep DTI under 36%, your housing payment should not exceed " + formatMoney(payment) + ".";
}

function readRiskMoney(id, blankValue) {
  const raw = document.getElementById(id).value.trim();
  if (raw === "") return { blank: true, value: blankValue };
  const value = parseAmount(raw);
  if (!Number.isFinite(value) || value < 0) return { invalid: true };
  return { value };
}

let riskMode = "quick";
let riskHasResult = false;

function readRiskForm() {
  const piti = readRiskMoney("risk-piti", null);
  if (piti.blank) return { error: "Enter the current mortgage payment (PITI)." };
  if (piti.invalid) return { error: "Current mortgage payment must be a number greater than or equal to 0." };
  const savings = readRiskMoney("risk-savings", null);
  if (savings.blank) return { error: "Enter liquid savings. Use 0 if you have none." };
  if (savings.invalid) return { error: "Liquid savings must be a number greater than or equal to 0." };
  const age = document.getElementById("risk-age").value;
  if (!AGE_BASELINE[age]) return { error: "Choose an age range." };
  const industry = document.getElementById("risk-industry").value;
  if (!INDUSTRY_SHIFT[industry]) return { error: "Choose an industry." };
  const income = readRiskMoney("risk-income", null);
  if (income.blank || income.invalid || income.value <= 0) {
    return { error: "Enter household monthly net income greater than 0." };
  }
  let living = QUICK_LIVING;
  let spouse = 0;
  let severance = 0;
  let children = null;
  if (riskMode === "detailed") {
    const livingField = readRiskMoney("risk-living", null);
    if (livingField.blank) return { error: "Enter monthly living expenses. Detailed Estimate does not guess this number." };
    if (livingField.invalid) return { error: "Monthly living expenses must be a number greater than or equal to 0." };
    const spouseField = readRiskMoney("risk-spouse", 0);
    if (spouseField.invalid) return { error: "Spouse or partner income must be a number greater than or equal to 0." };
    const severanceField = readRiskMoney("risk-severance", 0);
    if (severanceField.invalid) return { error: "Severance and unemployment benefits must be a number greater than or equal to 0." };
    const childrenRaw = document.getElementById("risk-children").value.trim();
    if (childrenRaw !== "") {
      const text = childrenRaw.replace(/,/g, "");
      if (!/^\d+$/.test(text)) return { error: "Number of children must be a whole number greater than or equal to 0." };
      children = Number(text);
    }
    living = livingField.value;
    spouse = spouseField.value;
    severance = severanceField.value;
  }
  return {
    value: {
      mode: riskMode,
      piti: piti.value,
      savings: savings.value,
      age,
      industry,
      income: income.value,
      living,
      spouse,
      severance,
      children,
    },
  };
}

function renderRisk(result) {
  const verdict = document.getElementById("risk-verdict");
  verdict.className = "risk-verdict is-" + result.level;
  const rating = { safe: "🟢 Safe", watch: "🟡 Watch", danger: "🔴 Danger" };
  document.getElementById("risk-rating").textContent = rating[result.level];
  document.getElementById("risk-headline").textContent = result.unlimited
    ? "Your emergency fund will last indefinitely."
    : "Your emergency fund will last for " + formatMonthCount(result.runwayShown) + ".";
  const estimateNote = document.getElementById("risk-estimate-note");
  if (result.estimatedLiving) {
    estimateNote.hidden = false;
    estimateNote.textContent = "Based on an estimated base living expense of $2,000/month.";
  } else {
    estimateNote.hidden = true;
    estimateNote.textContent = "";
  }
  document.getElementById("risk-search").textContent = formatMonthCount(result.searchMonths);
  document.getElementById("risk-search-note").textContent = searchNote(result.age, result.industry, result.searchMonths);
  document.getElementById("risk-burn").textContent = formatMoney(result.burn);
  let burnNote = result.estimatedLiving
    ? "One income. Housing plus an estimated $2,000 of living expenses."
    : result.dual
      ? "Two incomes. Spouse or partner pay is subtracted from the housing payment and living costs."
      : "One income. The housing payment and living costs both come out of savings.";
  if (result.burn < 0) burnNote += " Cash flow covers these costs, so savings are not drawn down.";
  else if (result.burn === 0) burnNote += " Cash flow covers these costs exactly.";
  document.getElementById("risk-burn-note").textContent = burnNote;
  const dtiText = document.getElementById("risk-dti");
  dtiText.textContent = result.dtiShown.toFixed(1) + "%";
  dtiText.className = "dti-value is-" + result.dtiBand;
  const dtiPct = Math.max(0, Math.min(result.dtiShown, 50)) / 50 * 100;
  const dtiFill = document.getElementById("risk-dti-fill");
  const dtiMark = document.getElementById("risk-dti-mark");
  dtiFill.style.width = dtiPct + "%";
  dtiMark.style.left = dtiPct + "%";
  dtiFill.className = "dti-meter-fill is-" + result.dtiBand;
  dtiMark.className = "dti-meter-mark is-" + result.dtiBand;
  const dtiNote = document.getElementById("risk-dti-note");
  if (result.dtiBand === "high") dtiNote.textContent = "Above 43% Max.";
  else if (result.dtiBand === "elevated") dtiNote.textContent = "Above 36% Preferred.";
  else dtiNote.textContent = "Within 36% Preferred.";
  document.getElementById("risk-safe").textContent = formatMoney(result.safePayment);
  const advice = document.getElementById("risk-advice");
  advice.textContent = adviceSentence(result.searchMonths, result.safePayment);
  advice.className = "risk-advice is-" + result.level;
  let safeNote = "The lower of the job-search cushion and 36% of household monthly net income.";
  if (result.cushion < 0) {
    safeNote = "Savings and severance do not cover living expenses through that job search, so the safe housing payment is $0.";
  } else if (result.cap < result.cushion) {
    safeNote = "36% of monthly net income is the tighter limit, so the payment is capped there.";
  }
  document.getElementById("risk-safe-note").textContent = safeNote;
  const childNote = document.getElementById("risk-children-note");
  if (result.children > 0) {
    const noun = result.children === 1 ? "child is" : "children are";
    childNote.textContent = result.children + " " + noun + " listed for context. Include their costs in monthly living expenses so they are not counted twice.";
  } else {
    childNote.textContent = "";
  }
}

function fillPitiFromStrategy() {
  const input = document.getElementById("risk-piti");
  const payment = document.getElementById("payment");
  if (!input || !payment || input.value.trim() !== "") return;
  const value = parseAmount(payment.textContent);
  if (!Number.isFinite(value) || value <= 0) return;
  input.value = Math.round(value).toLocaleString("en-US");
}

function showRiskModule(risk) {
  document.getElementById("strategy-panel").hidden = risk;
  document.getElementById("risk-panel").hidden = !risk;
  document.getElementById("tab-strategy").setAttribute("aria-selected", risk ? "false" : "true");
  document.getElementById("tab-risk").setAttribute("aria-selected", risk ? "true" : "false");
  document.getElementById("page-title").textContent = risk ? "Affordability risk" : "Mortgage payoff strategies";
  document.getElementById("page-subtitle").textContent = risk
    ? "See how long cash lasts if a paycheck stops, and where the housing payment sits against U.S. DTI lines"
    : "Compare extra payments, refinancing, and opportunity cost";
  document.getElementById("method-badge").hidden = risk;
  if (risk) fillPitiFromStrategy();
}

function applyRiskAssessment() {
  const message = document.getElementById("risk-message");
  const parsed = readRiskForm();
  if (parsed.error) {
    message.textContent = parsed.error;
    document.getElementById("risk-result").hidden = true;
    return;
  }
  const result = assessAffordability(parsed.value);
  if (result.error) {
    message.textContent = result.error === "income"
      ? "Enter household monthly net income greater than 0."
      : result.error === "living"
        ? "Enter monthly living expenses. Detailed Estimate does not guess this number."
        : "Check the numbers and try again.";
    document.getElementById("risk-result").hidden = true;
    return;
  }
  message.textContent = "";
  renderRisk(result);
  document.getElementById("risk-result").hidden = false;
  riskHasResult = true;
}

function refreshIfAssessed() {
  if (riskHasResult) applyRiskAssessment();
}

function setRiskMode(mode) {
  riskMode = mode === "detailed" ? "detailed" : "quick";
  const detailed = riskMode === "detailed";
  document.getElementById("risk-detailed").hidden = !detailed;
  document.getElementById("risk-form").classList.toggle("is-quick", !detailed);
  document.getElementById("mode-quick").setAttribute("aria-selected", detailed ? "false" : "true");
  document.getElementById("mode-detailed").setAttribute("aria-selected", detailed ? "true" : "false");
  document.getElementById("estimate-mode-note").textContent = detailed
    ? "Enter monthly living expenses. Spouse income, severance, and children are optional."
    : "Uses a $2,000 monthly living estimate. Spouse income and severance stay at $0.";
  refreshIfAssessed();
}

function initAffordability() {
  const form = document.getElementById("risk-form");
  if (!form) return;
  document.getElementById("tab-strategy").addEventListener("click", () => showRiskModule(false));
  document.getElementById("tab-risk").addEventListener("click", () => showRiskModule(true));
  document.getElementById("mode-quick").addEventListener("click", () => setRiskMode("quick"));
  document.getElementById("mode-detailed").addEventListener("click", () => setRiskMode("detailed"));
  ["risk-piti", "risk-savings", "risk-income", "risk-living", "risk-spouse", "risk-severance", "risk-children"].forEach((id) => {
    document.getElementById(id).addEventListener("input", refreshIfAssessed);
  });
  ["risk-age", "risk-industry"].forEach((id) => {
    document.getElementById(id).addEventListener("change", refreshIfAssessed);
  });
  const payment = document.getElementById("payment");
  if (payment) {
    new MutationObserver(fillPitiFromStrategy).observe(payment, { childList: true, characterData: true, subtree: true });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyRiskAssessment();
  });
}

if (typeof document !== "undefined") initAffordability();
