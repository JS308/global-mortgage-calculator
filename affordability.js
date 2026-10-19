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

function assessAffordability(input) {
  const searchMonths = expectedSearchMonths(input.age, input.industry);
  if (searchMonths == null) return { error: "choice" };
  if (!Number.isFinite(input.income) || input.income <= 0) return { error: "income" };
  const spouse = input.spouse > 0 ? input.spouse : 0;
  const severance = input.severance > 0 ? input.severance : 0;
  const dual = spouse > 0;
  const burn = dual ? input.piti + input.living - spouse : input.piti + input.living;
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
  const cushion = (input.savings + severance) / searchMonths - input.living + spouse;
  const cap = input.income * 0.36;
  if (!Number.isFinite(cushion) || !Number.isFinite(cap)) return { error: "burn" };
  const safePayment = Math.max(0, Math.min(cushion, cap));
  let dtiBand = "ok";
  if (dtiShown > 43) dtiBand = "high";
  else if (dtiShown > 36) dtiBand = "elevated";
  return {
    age: input.age,
    industry: input.industry,
    children: input.children,
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
  let note = ageLabel + " starts at " + formatMonthCount(base) + ".";
  if (shift > 0) note += " " + industryLabel + " adds " + formatMonthCount(shift) + ".";
  else if (shift < 0) note += " " + industryLabel + " shortens that by " + formatMonthCount(Math.abs(shift)) + ".";
  else note += " " + industryLabel + " does not change it.";
  if (months !== base + shift) note += " Shown time is kept at 1 month so the safe payment can be calculated.";
  return note;
}

function adviceSentence(months, payment) {
  const article = months === 8 || months === 11 || months === 18 ? "an" : "a";
  return "To survive " + article + " " + months + "-month job search without defaulting, your monthly housing payment should not exceed " + formatMoney(payment) + ".";
}

function readRiskMoney(id, blankValue) {
  const raw = document.getElementById(id).value.trim();
  if (raw === "") return { blank: true, value: blankValue };
  const value = parseAmount(raw);
  if (!Number.isFinite(value) || value < 0) return { invalid: true };
  return { value };
}

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
  const living = readRiskMoney("risk-living", null);
  if (living.blank) return { error: "Enter monthly living expenses. Use 0 if you have none." };
  if (living.invalid) return { error: "Monthly living expenses must be a number greater than or equal to 0." };
  const spouse = readRiskMoney("risk-spouse", 0);
  if (spouse.invalid) return { error: "Spouse or partner income must be a number greater than or equal to 0." };
  const severance = readRiskMoney("risk-severance", 0);
  if (severance.invalid) return { error: "Severance and unemployment benefits must be a number greater than or equal to 0." };
  const childrenRaw = document.getElementById("risk-children").value.trim();
  let children = null;
  if (childrenRaw !== "") {
    const text = childrenRaw.replace(/,/g, "");
    if (!/^\d+$/.test(text)) return { error: "Number of children must be a whole number greater than or equal to 0." };
    children = Number(text);
  }
  return {
    value: {
      piti: piti.value,
      savings: savings.value,
      age,
      industry,
      income: income.value,
      living: living.value,
      spouse: spouse.value,
      severance: severance.value,
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
  document.getElementById("risk-search").textContent = formatMonthCount(result.searchMonths);
  document.getElementById("risk-search-note").textContent = searchNote(result.age, result.industry, result.searchMonths);
  document.getElementById("risk-burn").textContent = formatMoney(result.burn);
  let burnNote = result.dual
    ? "Two incomes. Spouse or partner pay is subtracted from the housing payment and living costs."
    : "One income. The housing payment and living costs both come out of savings.";
  if (result.burn < 0) burnNote += " Cash flow covers these costs, so savings are not drawn down.";
  else if (result.burn === 0) burnNote += " Cash flow covers these costs exactly.";
  document.getElementById("risk-burn-note").textContent = burnNote;
  document.getElementById("risk-dti").textContent = result.dtiShown.toFixed(1) + "%";
  const dtiNote = document.getElementById("risk-dti-note");
  if (result.dtiBand === "high") {
    dtiNote.textContent = "Above 43%. Lenders often treat a housing burden past this line as high risk.";
  } else if (result.dtiBand === "elevated") {
    dtiNote.textContent = "Above 36%. This is past the preferred U.S. housing limit.";
  } else {
    dtiNote.textContent = "At or under 36%, the preferred U.S. housing limit.";
  }
  dtiNote.className = "mt-2 text-xs leading-relaxed " + (result.dtiBand === "ok" ? "text-slate-500" : "text-rose-700");
  document.getElementById("risk-safe").textContent = formatMoney(result.safePayment);
  document.getElementById("risk-advice").textContent = adviceSentence(result.searchMonths, result.safePayment);
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

function initAffordability() {
  const form = document.getElementById("risk-form");
  if (!form) return;
  document.getElementById("tab-strategy").addEventListener("click", () => showRiskModule(false));
  document.getElementById("tab-risk").addEventListener("click", () => showRiskModule(true));
  const payment = document.getElementById("payment");
  if (payment) {
    new MutationObserver(fillPitiFromStrategy).observe(payment, { childList: true, characterData: true, subtree: true });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
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
        : "Check the numbers and try again.";
      document.getElementById("risk-result").hidden = true;
      return;
    }
    message.textContent = "";
    renderRisk(result);
    document.getElementById("risk-result").hidden = false;
  });
}

if (typeof document !== "undefined") initAffordability();
