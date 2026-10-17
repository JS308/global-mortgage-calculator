const form = document.getElementById("form");
const message = document.getElementById("message");
const result = document.getElementById("result");
const payment = document.getElementById("payment");
const extraList = document.getElementById("extra-list");
const comparison = document.getElementById("comparison");
const comparisonBody = document.getElementById("comparison-body");
const planSwitch = document.getElementById("plan-switch");
const scheduleBody = document.getElementById("schedule-body");
const chartNote = document.getElementById("chart-note");
const interestChartNote = document.getElementById("interest-chart-note");
const CHART_SRC = "https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js";
const HTML2CANVAS_SRC = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
const JSPDF_SRC = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
const fieldClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none ring-slate-900 focus:ring-2";

let viewPlans = [];
let activePlanId = "original";
let balanceChart = null;
let interestChart = null;
let chartToken = 0;
let latestReport = null;

planSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !button.dataset.plan) return;
  activePlanId = button.dataset.plan;
  renderPlanSwitch();
  renderTable();
});

document.getElementById("export-schedule").addEventListener("click", exportSelectedPlans);
document.getElementById("export-pdf").addEventListener("click", () => {
  const button = document.getElementById("export-pdf");
  button.disabled = true;
  button.textContent = "Creating…";
  createPdfReport()
    .then((pdf) => pdf.save("mortgage-payoff-report.pdf"))
    .catch((error) => {
      message.textContent = error.message || "Could not create the PDF";
    })
    .finally(() => {
      button.disabled = false;
      button.textContent = "Export PDF report";
    });
});

document.getElementById("add-extra").addEventListener("click", () => {
  addExtraRow();
});
bindAmountInput(document.getElementById("principal"));
bindAmountInput(document.getElementById("spare"));
bindAmountInput(document.getElementById("refi-fee"));
bindAmountInput(document.getElementById("prepay"));
bindAmountInput(document.getElementById("pmi"));
bindAmountInput(document.getElementById("property-tax"));
bindAmountInput(document.getElementById("home-insurance"));

const loanFixedButton = document.getElementById("loan-fixed");
const loanArmButton = document.getElementById("loan-arm");
const armFields = document.getElementById("arm-fields");
let loanType = "fixed";
const modeButtonOn = "rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white";
const modeButtonOff = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800";

loanFixedButton.addEventListener("click", () => setLoanType("fixed"));
loanArmButton.addEventListener("click", () => setLoanType("arm"));

const methodInstallmentButton = document.getElementById("method-installment");
const methodPrincipalButton = document.getElementById("method-principal");
const methodBadge = document.getElementById("method-badge");
let repayMethod = "installment";
let paidMonthsShown = 0;
let paidHistory = [];
methodInstallmentButton.addEventListener("click", () => setRepayMethod("installment"));
methodPrincipalButton.addEventListener("click", () => setRepayMethod("principal"));
document.getElementById("balance-chart").closest("details").addEventListener("toggle", () => {
  if (balanceChart) balanceChart.resize();
  if (interestChart) interestChart.resize();
});
["years", "arm-years", "paid-months"].forEach((id) => {
  document.getElementById(id).addEventListener("input", refreshRemaining);
});

form.addEventListener("input", (event) => {
  if (event.target.classList) event.target.classList.remove("field-missing");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  message.textContent = "";
  result.hidden = true;

  const missing = missingRequiredFields();
  markMissingFields(missing);
  if (missing.length) {
    message.textContent = "Fill in the required fields: " + missing.map((item) => item[1]).join(", ");
    message.scrollIntoView({ block: "nearest" });
    document.getElementById(missing[0][0]).focus();
    return;
  }

  try {
    const years = readYears("years", "Loan term");
    const paid = readPaidMonths(years * 12);
    const extras = readExtras(years, paid);
    const arm = readArm(years);
    const housing = readHousing();
    const opportunityInput = readOpportunity();
    const refinanceInput = readRefinance();
    const principal = readDollar("principal");
    const ratePercent = readNumber("rate");
    const rate = ratePercent / 100;
    const singlePrepay = readOptionalPrepay("prepay");
    const planExtras = extras.slice();
    if (singlePrepay > 0) planExtras.push({ 月份: 1, 金额: singlePrepay });
    const original = runSchedule(repayMethod, "shorten", principal, rate, years, null, paid, arm);
    const heldRate = arm
      ? runSchedule(repayMethod, "shorten", principal, rate, years, null, paid, null)
      : null;
    const originalInterest = sumInterest(original);
    const originalPayment = original[0].月供;
    const interestSummary = buildInterestSummary({ original, principal, rate, years, paid, arm });
    const monthlyHousing = roundMoney(originalPayment + housing.monthlyEscrow);

    payment.textContent = formatMoney(monthlyHousing);
    renderHousing(originalPayment, housing);
    renderArmNote(original, arm, paid);
    renderInterestSplit(interestSummary);

    let shortened = null;
    let reduced = null;
    if (planExtras.length > 0) {
      shortened = runSchedule(repayMethod, "shorten", principal, rate, years, planExtras, paid, arm);
      reduced = runSchedule(repayMethod, "reduce", principal, rate, years, planExtras, paid, arm);
    }
    const opportunity = opportunityInput
      ? calcOpportunity(principal, rate, years, opportunityInput.cash, opportunityInput.ratePercent / 100, repayMethod, paid, arm)
      : null;
    const refinance = refinanceInput
      ? calcRefinance(principal, rate, years, refinanceInput.ratePercent / 100, refinanceInput.fee, repayMethod, paid, arm)
      : null;
    const biweekly = document.getElementById("biweekly").checked
      ? calcBiweekly(principal, rate, years, paid, repayMethod, arm)
      : null;
    renderBiweekly(biweekly);
    const comparisonRows = buildComparisonRows({
      original,
      originalInterest,
      originalPayment,
      extras: planExtras,
      shortened,
      reduced,
      opportunity,
      refinance,
      biweekly,
      methodLabel: repayMethod === "principal" ? "Equal principal" : "Fixed payment",
      arm,
      heldRate,
      paid,
    });
    renderComparison(comparisonRows);
    result.hidden = false;
    const startingBalance = roundMoney(original[0].剩余本金 + original[0].本金部分);
    showPlans(startingBalance, chartPlans({
      original,
      shortened,
      reduced,
      opportunity,
      refinance,
      biweekly,
      heldRate,
    }));
    latestReport = {
      principal,
      ratePercent,
      years,
      extras: planExtras.slice(),
      loanType,
      arm: arm ? { fixedYears: arm.fixedYears, adjustedPercent: roundMoney(arm.adjustedRate * 100) } : null,
      housing,
      monthlyHousing,
      biweekly,
      originalPayment,
      originalInterest,
      interestSummary,
      opportunity: opportunity && opportunityInput
        ? {
          cash: opportunityInput.cash,
          depositRatePercent: opportunityInput.ratePercent,
          result: opportunity,
        }
        : null,
      refinance: refinance && refinanceInput
        ? {
          ratePercent: refinanceInput.ratePercent,
          fee: refinanceInput.fee,
          result: refinance,
        }
        : null,
      paid,
      prepay: singlePrepay,
      repayMethod,
      comparison: comparisonRows,
      plans: viewPlans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        schedule: plan.schedule,
      })),
    };
  } catch (error) {
    message.textContent = error.message;
    latestReport = null;
    clearVisualization();
  }
});

function addExtraRow() {
  const row = document.createElement("div");
  row.className = "extra-row grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2";
  row.innerHTML = [
    '<label class="block text-sm font-medium text-slate-700">Payment number<input class="extra-remaining ' + fieldClass + '" type="text" inputmode="numeric" placeholder="e.g. 120" autocomplete="off"></label>',
    '<label class="block text-sm font-medium text-slate-700">Amount<input class="extra-amount ' + fieldClass + '" type="text" inputmode="decimal" placeholder="e.g. 10,000" autocomplete="off"></label>',
    '<button type="button" class="remove justify-self-start text-sm font-medium text-rose-700 sm:col-span-2">Remove</button>',
  ].join("");
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  bindAmountInput(row.querySelector(".extra-amount"));
  extraList.appendChild(row);
  return row;
}

function setLoanType(type) {
  loanType = type === "arm" ? "arm" : "fixed";
  const arm = loanType === "arm";
  armFields.hidden = !arm;
  loanFixedButton.className = arm ? modeButtonOff : modeButtonOn;
  loanArmButton.className = arm ? modeButtonOn : modeButtonOff;
  document.getElementById("rate-label").textContent = arm ? "Initial interest rate (%)" : "Interest rate (%)";
  document.getElementById("arm-years").required = arm;
  document.getElementById("arm-rate").required = arm;
  markMissingFields([]);
}

function missingRequiredFields() {
  const fields = [
    ["principal", "loan amount"],
    ["rate", "interest rate"],
    ["years", "loan term"],
  ];
  if (loanType === "arm") {
    fields.push(["arm-years", "ARM fixed period"], ["arm-rate", "adjusted rate"]);
  }
  return fields.filter(([id]) => document.getElementById(id).value.trim() === "");
}

function markMissingFields(missing) {
  document.querySelectorAll("input.field-missing").forEach((input) => input.classList.remove("field-missing"));
  missing.forEach(([id]) => document.getElementById(id).classList.add("field-missing"));
}

function setRepayMethod(method) {
  repayMethod = method === "principal" ? "principal" : "installment";
  const principal = repayMethod === "principal";
  methodInstallmentButton.className = principal ? modeButtonOff : modeButtonOn;
  methodPrincipalButton.className = principal ? modeButtonOn : modeButtonOff;
  methodBadge.textContent = principal ? "Equal principal" : "Fixed payment";
}

function readArm(years) {
  if (loanType !== "arm") return null;
  const fixedYears = readYears("arm-years", "ARM fixed period");
  const adjustedPercent = readNumber("arm-rate");
  if (!Number.isFinite(adjustedPercent) || adjustedPercent < 0) {
    throw new Error("Adjusted rate must be a number greater than or equal to 0");
  }
  if (fixedYears >= years) {
    throw new Error("ARM fixed period must be shorter than the loan term");
  }
  return { fixedYears, adjustedRate: adjustedPercent / 100 };
}

function readHousing() {
  const pmi = readOptionalMoney("pmi", "PMI");
  const propertyTax = readOptionalMoney("property-tax", "Property tax");
  const insurance = readOptionalMoney("home-insurance", "Home insurance");
  return {
    pmi,
    propertyTax,
    insurance,
    taxMonthly: roundMoney(propertyTax / 12),
    insuranceMonthly: roundMoney(insurance / 12),
    monthlyEscrow: roundMoney(pmi + propertyTax / 12 + insurance / 12),
  };
}

function renderHousing(principalAndInterest, housing) {
  document.getElementById("pi-payment").textContent = formatMoney(principalAndInterest);
  document.getElementById("pmi-payment").textContent = formatMoney(housing.pmi);
  document.getElementById("tax-payment").textContent = formatMoney(housing.taxMonthly);
  document.getElementById("insurance-payment").textContent = formatMoney(housing.insuranceMonthly);
}

function renderArmNote(schedule, arm, paid) {
  const note = document.getElementById("pi-note");
  if (!arm) {
    note.hidden = true;
    note.textContent = "";
    return;
  }
  const later = paymentAfterAdjustment(schedule, arm.fixedYears, paid);
  note.hidden = false;
  note.textContent = later == null
    ? "This schedule is paid off before the rate adjusts."
    : "After " + arm.fixedYears + " years the rate becomes " + roundMoney(arm.adjustedRate * 100) + "% and principal and interest becomes " + formatMoney(later) + ".";
}

function paymentAfterAdjustment(schedule, fixedYears, paid) {
  const index = fixedYears * 12 - (paid || 0);
  if (index <= 0 || index >= schedule.length) return null;
  return schedule[index].月供;
}

function renderBiweekly(result) {
  const box = document.getElementById("biweekly-box");
  if (!result) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  document.getElementById("biweekly-payment").textContent = formatMoney(result.biweeklyPayment);
  const lines = [
    "26 payments a year. Paid off " + result.monthsSaved + " months sooner and saves " + formatMoney(result.savedInterest) + " in interest versus the monthly plan.",
  ];
  if (result.laterBiweeklyPayment !== result.biweeklyPayment) {
    lines.push("After the ARM adjusts, the bi-weekly draft becomes " + formatMoney(result.laterBiweeklyPayment) + ".");
  }
  document.getElementById("biweekly-note").textContent = lines.join(" ");
}

function buildInterestSummary(input) {
  const paid = input.paid || 0;
  const remaining = sumInterest(input.original);
  if (paid <= 0) {
    rememberPaidHistory(input.original, 0);
    return { paid, full: remaining, remaining };
  }
  const full = runSchedule(repayMethod, "shorten", input.principal, input.rate, input.years, null, 0, input.arm);
  rememberPaidHistory(full, paid);
  return { paid, full: sumInterest(full), remaining };
}

function rememberPaidHistory(schedule, paid) {
  paidMonthsShown = paid;
  paidHistory = paid > 0
    ? schedule.slice(0, paid).map((row) => ({
      月份: row.月份,
      月供: row.月供,
      本金部分: row.本金部分,
      利息部分: row.利息部分,
      剩余本金: row.剩余本金,
      已还: true,
    }))
    : [];
}

function displaySchedule(plan) {
  const future = plan.schedule.map((row) => ({
    月份: row.月份 + paidMonthsShown,
    月供: row.月供,
    本金部分: row.本金部分,
    利息部分: row.利息部分,
    剩余本金: row.剩余本金,
    已还: false,
  }));
  return paidHistory.concat(future);
}

function interestProgress(summary) {
  if (!summary.full) return 0;
  return Math.round(roundMoney(summary.full - summary.remaining) / summary.full * 100);
}

function renderInterestSplit(summary) {
  document.getElementById("original-interest").textContent = formatMoney(summary.full);
  const wrap = document.getElementById("interest-progress-wrap");
  const note = document.getElementById("schedule-paid-note");
  if (summary.paid > 0) {
    const percent = interestProgress(summary);
    wrap.hidden = false;
    document.getElementById("remaining-interest").textContent = formatMoney(summary.remaining);
    document.getElementById("interest-percent").textContent = percent + "% paid";
    const bar = document.getElementById("interest-progress");
    bar.style.width = percent + "%";
    bar.parentElement.setAttribute("aria-valuenow", String(percent));
    bar.parentElement.setAttribute("aria-valuemin", "0");
    bar.parentElement.setAttribute("aria-valuemax", "100");
    note.textContent = "Shaded rows are the " + summary.paid + " payments already made";
  } else {
    wrap.hidden = true;
    note.textContent = "";
  }
}

function refreshRemaining() {
  const box = document.getElementById("remaining-months");
  const paidRaw = document.getElementById("paid-months").value.trim();
  const paid = paidRaw === "" ? 0 : Number(paidRaw);
  const paidOk = Number.isInteger(paid) && paid >= 0;
  if (!paidOk) {
    box.textContent = "Payments already made must be a whole number";
    return;
  }
  const years = readNumber("years");
  if (!Number.isInteger(years) || years <= 0) {
    box.textContent = "Enter a term to see this";
    return;
  }
  box.textContent = formatRemaining(years * 12, paid);
}

function formatRemaining(total, paid) {
  const left = total - paid;
  if (left <= 0) return "Paid off";
  return left + " payments";
}

function readPaidMonths(maxMonths) {
  const raw = document.getElementById("paid-months").value.trim();
  if (raw === "") return 0;
  const paid = Number(raw);
  if (!Number.isInteger(paid) || paid < 0) {
    throw new Error("Payments already made must be a whole number greater than or equal to 0");
  }
  if (paid >= maxMonths) {
    throw new Error("Payments already made must be less than the " + maxMonths + " payments in the loan term");
  }
  return paid;
}

function readOptionalPrepay(id) {
  return readOptionalMoney(id, "Extra principal payment");
}

function readExtras(years, paid) {
  const totalMonths = years * 12;
  const elapsed = paid || 0;
  const extras = [];
  let index = 0;
  extraList.querySelectorAll(".extra-row").forEach((row) => {
    const periodRaw = row.querySelector(".extra-remaining").value.trim();
    const amountRaw = row.querySelector(".extra-amount").value.trim();
    if (periodRaw === "" && amountRaw === "") return;
    index += 1;
    const period = Number(periodRaw);
    const firstPeriod = elapsed + 1;
    if (!Number.isInteger(period) || period < firstPeriod || period > totalMonths) {
      throw new Error("Extra payment " + index + " must fall between payment " + firstPeriod + " and " + totalMonths);
    }
    const amount = parseAmount(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Extra payment " + index + " amount must be greater than 0");
    }
    extras.push({
      月份: period - elapsed,
      金额: roundMoney(amount),
    });
  });
  return extras;
}

function readOpportunity() {
  const cashRaw = document.getElementById("spare").value.trim();
  const rateRaw = document.getElementById("deposit-rate").value.trim();
  if (cashRaw === "" && rateRaw === "") return null;
  if (cashRaw === "" || rateRaw === "") {
    throw new Error("Opportunity cost needs both the cash amount and the APY");
  }
  const cash = roundMoney(parseAmount(cashRaw));
  const ratePercent = Number(rateRaw);
  if (!Number.isFinite(cash) || cash <= 0) {
    throw new Error("Cash on hand must be a number greater than 0");
  }
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    throw new Error("Savings or investment APY must be a number greater than or equal to 0");
  }
  return { cash, ratePercent };
}

function formatBenefit(amount) {
  const text = formatMoney(Math.abs(amount));
  if (amount > 0) return "+" + text;
  if (amount < 0) return "-" + text;
  return text;
}

function readRefinance() {
  const rateRaw = document.getElementById("refi-rate").value.trim();
  const feeRaw = document.getElementById("refi-fee").value.trim();
  if (rateRaw === "" && feeRaw === "") return null;
  if (rateRaw === "") throw new Error("Enter the new interest rate to compare a refinance");
  const ratePercent = Number(rateRaw);
  const fee = feeRaw === "" ? 0 : roundMoney(parseAmount(feeRaw));
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    throw new Error("Refinance rate must be a number greater than or equal to 0");
  }
  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error("Refinance closing costs must be a number greater than or equal to 0");
  }
  return { ratePercent, fee };
}

function formatPayback(result) {
  if (result.手续费 <= 0) return "No closing costs";
  if (result.回本月数 == null) return "Does not break even during the term";
  return formatTerm(result.回本月数);
}

function buildComparisonRows(input) {
  const totalMonths = input.original.length;
  const adjustedPayment = input.arm
    ? paymentAfterAdjustment(input.original, input.arm.fixedYears, input.paid)
    : null;
  const rows = [{
    name: "Original plan",
    note: input.arm
      ? [
        input.methodLabel + ", full remaining term of " + formatTerm(totalMonths),
        "Rate becomes " + roundMoney(input.arm.adjustedRate * 100) + "% after " + input.arm.fixedYears + " years",
        armPaymentNote(input.originalPayment, adjustedPayment),
      ].join("\n")
      : input.methodLabel + ", full remaining term of " + formatTerm(totalMonths),
    benefit: 0,
    order: 50,
  }];
  if (input.arm && input.heldRate) {
    rows.push({
      name: "Initial rate for the full term",
      note: "Keeps the starting rate and " + formatMoney(input.heldRate[0].月供) + " for the whole term",
      benefit: roundMoney(input.originalInterest - sumInterest(input.heldRate)),
      order: 45,
    });
  }
  if (input.shortened) {
    rows.push({
      name: "Extra principal, shorter term",
      note: shortenNote(totalMonths, input.shortened.length),
      benefit: roundMoney(input.originalInterest - sumInterest(input.shortened)),
      order: 10,
    });
  }
  if (input.biweekly) {
    const item = input.biweekly;
    const lines = [
      formatMoney(item.biweeklyPayment) + " every two weeks",
      shortenNote(item.monthlyMonths, item.payoffMonths),
    ];
    if (item.laterBiweeklyPayment !== item.biweeklyPayment) {
      lines.push("After the adjustment, " + formatMoney(item.laterBiweeklyPayment) + " every two weeks");
    }
    rows.push({
      name: "Bi-weekly payments",
      note: lines.join("\n"),
      benefit: item.savedInterest,
      order: 15,
    });
  }
  if (input.reduced) {
    const paymentAmount = reducedMonthlyPayment(input.reduced, input.extras, totalMonths, input.originalPayment);
    rows.push({
      name: "Extra principal, lower payment",
      note: paymentChangeNote(input.originalPayment, paymentAmount),
      benefit: roundMoney(input.originalInterest - sumInterest(input.reduced)),
      order: 20,
    });
  }
  if (input.opportunity) {
    const item = input.opportunity;
    rows.push({
      name: "Cash toward a shorter term",
      note: shortenNote(item.原期数, item.还清月份),
      benefit: item.缩短节省利息,
      order: 30,
    });
    rows.push({
      name: "Cash toward a lower payment",
      note: paymentChangeNote(item.缩短月供, item.减供月供),
      benefit: item.减供节省利息,
      order: 35,
    });
    rows.push({
      name: "Monthly compounded savings",
      note: formatMoney(item.到期金额) + " at maturity, saved for " + formatTerm(item.原期数),
      benefit: item.存款收益,
      order: 40,
    });
  }
  if (input.refinance) {
    const item = input.refinance;
    const lines = [paymentChangeNote(input.originalPayment, item.新月供), "Break-even: " + formatPayback(item)];
    if (item.手续费 > 0) lines.push("Closing costs of " + formatMoney(item.手续费) + " already deducted");
    rows.push({
      name: "Refinance",
      note: lines.join("\n"),
      benefit: roundMoney(item.节省利息 - item.手续费),
      order: 60,
    });
  }
  if (rows.length < 2) return [];
  rows.sort((a, b) => b.benefit - a.benefit || a.order - b.order);
  let markedSecond = false;
  rows.forEach((row, index) => {
    row.rank = index + 1;
    if (row.benefit < 0) row.tone = "bad";
    else if (index === 0 || (rows[0].benefit > 0 && row.benefit === rows[0].benefit)) row.tone = "best";
    else if (row.benefit > 0 && !markedSecond) {
      row.tone = "second";
      markedSecond = true;
    } else if (row.benefit > 0) row.tone = "ok";
    else row.tone = "base";
  });
  return rows;
}

function readYears(id, label) {
  const years = readNumber(id);
  if (!Number.isInteger(years) || years <= 0) {
    throw new Error(label + " must be a whole number of years greater than 0");
  }
  return years;
}

function monthsShortened(total, end) {
  if (end == null || !Number.isFinite(end)) return 0;
  return Math.max(0, total - end);
}

function shortenNote(total, end) {
  const months = monthsShortened(total, end);
  if (months <= 0) return "Term is not shortened";
  return "Pays off " + months + " months sooner";
}

function armPaymentNote(before, after) {
  if (after == null) return "Paid off before the rate adjusts";
  const delta = roundMoney(after - before);
  if (delta > 0) return "Payment rises from " + formatMoney(before) + " to " + formatMoney(after);
  if (delta < 0) return "Payment falls from " + formatMoney(before) + " to " + formatMoney(after);
  return "Payment stays " + formatMoney(before) + " after the rate adjusts";
}

function paymentChangeNote(before, after) {
  const drop = roundMoney(before - after);
  if (drop > 0) return "Payment drops by " + formatMoney(drop);
  if (drop < 0) return "Payment rises by " + formatMoney(-drop);
  return "Payment stays the same";
}

function renderComparison(rows) {
  comparisonBody.replaceChildren();
  if (!rows.length) {
    comparison.hidden = true;
    return;
  }
  const toneClass = {
    best: "bg-emerald-50 text-emerald-950",
    second: "bg-sky-50 text-sky-950",
    ok: "bg-white text-slate-900",
    base: "bg-slate-50 text-slate-700",
    bad: "bg-rose-50 text-rose-950",
  };
  const rankText = {
    best: "Best",
    second: "Next",
  };
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = toneClass[row.tone] + " border-b border-slate-200";
    const rank = document.createElement("td");
    rank.className = "break-words px-2 py-3 align-top text-xs font-semibold leading-relaxed";
    rank.textContent = rankText[row.tone] ? row.rank + " " + rankText[row.tone] : String(row.rank);
    const name = document.createElement("td");
    name.className = "break-words px-2 py-3 align-top text-sm font-semibold leading-relaxed";
    name.textContent = row.name;
    const note = document.createElement("td");
    note.className = "whitespace-pre-line break-words px-2 py-3 align-top text-xs leading-relaxed";
    note.textContent = row.note;
    const benefit = document.createElement("td");
    benefit.className = "break-words px-2 py-3 text-right align-top text-sm font-semibold leading-relaxed tabular-nums";
    benefit.textContent = formatBenefit(row.benefit);
    tr.append(rank, name, note, benefit);
    comparisonBody.append(tr);
  });
  comparison.hidden = false;
}

function reducedMonthlyPayment(schedule, extras, originalMonths, originalPayment) {
  const lastExtraMonth = extras.reduce((max, item) => Math.max(max, item.月份), 0);
  const upcoming = schedule.find((row) => row.月份 > lastExtraMonth);
  if (!upcoming) {
    return schedule[schedule.length - 1].月份 < originalMonths ? 0 : originalPayment;
  }
  return upcoming.月供;
}

function formatTerm(totalMonths) {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return months + (months === 1 ? " month" : " months");
  if (months === 0) return years + (years === 1 ? " year" : " years");
  return years + (years === 1 ? " year " : " years ") + months + (months === 1 ? " month" : " months");
}

function sumInterest(schedule) {
  return roundMoney(schedule.reduce((sum, row) => sum + row.利息部分, 0));
}

function parseAmount(raw) {
  let text = String(raw == null ? "" : raw).trim().replace(/[\s\u00a0\u202f$]/g, "").replace(/，/g, ",");
  if (text === "") return NaN;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma !== -1) {
    const parts = text.split(",");
    text = parts.slice(1).every((part) => /^\d{3}$/.test(part))
      ? parts.join("")
      : parts[0] + "." + parts.slice(1).join("");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return NaN;
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
}

function readNumber(id) {
  return parseAmount(document.getElementById(id).value);
}

function readDollar(id) {
  const amount = readNumber(id);
  if (!Number.isFinite(amount)) return amount;
  return roundMoney(amount);
}

function readOptionalMoney(id, label) {
  const raw = document.getElementById(id).value.trim();
  if (raw === "") return 0;
  const value = parseAmount(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(label + " must be a number greater than or equal to 0");
  }
  return roundMoney(value);
}

function formatMoney(amount) {
  const sign = amount < 0 ? "-" : "";
  return sign + "$" + Math.abs(roundMoney(amount)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAmountInput(value) {
  const amount = parseAmount(String(value).replace(/[.,]+$/, ""));
  if (!Number.isFinite(amount)) return "";
  const cents = Math.round(amount * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === 0 ? grouped : grouped + "." + String(frac).padStart(2, "0");
}

function bindAmountInput(input) {
  input.addEventListener("input", () => {
    const raw = input.value;
    const cleaned = raw.replace(/[^\d,.]/g, "");
    if (cleaned === raw) return;
    const pos = input.selectionStart == null ? cleaned.length : input.selectionStart;
    const removedBefore = raw.slice(0, pos).length - raw.slice(0, pos).replace(/[^\d,.]/g, "").length;
    input.value = cleaned;
    const next = Math.max(0, pos - removedBefore);
    input.setSelectionRange(next, next);
  });
  input.addEventListener("blur", () => {
    if (input.value.trim() === "") return;
    input.value = formatAmountInput(input.value);
  });
}

function chartPlans(input) {
  const plans = [{
    id: "original",
    name: input.heldRate ? "ARM after adjustment" : "Original plan",
    schedule: input.original,
    color: "#64748b",
  }];
  const add = (id, name, schedule, color) => {
    if (schedule && schedule.length) plans.push({ id, name, schedule, color });
  };
  add("extra-shorten", "Extra principal, shorter term", input.shortened, "#dc2626");
  add("extra-reduce", "Extra principal, lower payment", input.reduced, "#2563eb");
  add("biweekly", "Bi-weekly payments", input.biweekly && input.biweekly.schedule, "#16a34a");
  add("spare-shorten", "Cash toward a shorter term", input.opportunity && input.opportunity.缩短计划, "#ea580c");
  add("spare-reduce", "Cash toward a lower payment", input.opportunity && input.opportunity.减供计划, "#9333ea");
  add("refinance", "Refinance", input.refinance && input.refinance.计划, "#0891b2");
  add("arm-initial", "Initial rate for the full term", input.heldRate, "#0f766e");
  return plans;
}

function showPlans(principal, plans) {
  viewPlans = plans;
  if (!viewPlans.some((plan) => plan.id === activePlanId)) {
    const preferred = viewPlans.find((plan) => plan.id !== "original" && plan.id !== "arm-initial");
    activePlanId = preferred ? preferred.id : "original";
  }
  renderChart(roundMoney(principal));
  renderPlanSwitch();
  renderExportOptions();
  renderTable();
}

function clearVisualization() {
  viewPlans = [];
  chartToken += 1;
  paidMonthsShown = 0;
  paidHistory = [];
  scheduleBody.replaceChildren();
  planSwitch.replaceChildren();
  document.getElementById("export-plan-options").replaceChildren();
  document.getElementById("schedule-paid-note").textContent = "";
  document.getElementById("interest-progress-wrap").hidden = true;
  chartNote.textContent = "";
  interestChartNote.textContent = "";
  balanceChart = destroyChart(balanceChart);
  interestChart = destroyChart(interestChart);
}

function destroyChart(chart) {
  if (chart) chart.destroy();
  return null;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load a required script")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load a required script"));
    document.head.appendChild(script);
  });
}

function remainingInterestSeries(schedule) {
  const points = new Array(schedule.length + 1);
  let suffix = 0;
  points[schedule.length] = 0;
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    suffix += schedule[i].利息部分;
    points[i] = roundMoney(suffix);
  }
  return points;
}

function lineDatasets(valuesForPlan) {
  return viewPlans.map((plan) => ({
    label: plan.name,
    data: valuesForPlan(plan),
    borderColor: plan.color,
    backgroundColor: plan.color,
    borderWidth: 2,
    pointRadius: 0,
    tension: 0,
  }));
}

function openingChartBalance(fallback) {
  if (paidHistory.length) return roundMoney(paidHistory[0].剩余本金 + paidHistory[0].本金部分);
  const original = viewPlans.find((plan) => plan.id === "original");
  if (original && original.schedule.length) {
    const row = original.schedule[0];
    return roundMoney(row.剩余本金 + row.本金部分);
  }
  return fallback;
}

function balanceChartPoints(plan, fallback) {
  const original = viewPlans.find((item) => item.id === "original") || plan;
  const points = [{ x: 0, y: openingChartBalance(fallback) }];
  paidHistory.forEach((row) => points.push({ x: row.月份, y: row.剩余本金 }));
  plan.schedule.forEach((row, index) => {
    const month = paidMonthsShown + row.月份;
    const baseRow = original.schedule[index];
    const extra = baseRow ? roundMoney(row.本金部分 - baseRow.本金部分) : 0;
    if (extra > 0) {
      const before = roundMoney(row.剩余本金 + row.本金部分);
      points.push({ x: month, y: before });
      points.push({ x: month, y: roundMoney(before - extra) });
    }
    points.push({ x: month, y: row.剩余本金 });
  });
  return points;
}

function interestChartPoints(plan) {
  const original = viewPlans.find((item) => item.id === "original") || plan;
  const originalForward = remainingInterestSeries(original.schedule);
  const forward = remainingInterestSeries(plan.schedule);
  const paidInterest = roundMoney(paidHistory.reduce((sum, row) => sum + row.利息部分, 0));
  const atStart = roundMoney(paidInterest + (originalForward[0] || 0));
  const points = [{ x: 0, y: atStart }];
  let consumed = 0;
  paidHistory.forEach((row) => {
    consumed = roundMoney(consumed + row.利息部分);
    points.push({ x: row.月份, y: roundMoney(atStart - consumed) });
  });
  if (roundMoney(points[points.length - 1].y - forward[0]) !== 0) {
    const dropMonth = paidMonthsShown + 1;
    points.push({ x: dropMonth, y: points[points.length - 1].y });
    points.push({ x: dropMonth, y: forward[0] });
  }
  for (let index = 1; index < forward.length; index += 1) {
    points.push({ x: paidMonthsShown + index, y: forward[index] });
  }
  return points;
}

function moneyTick(value) {
  const sign = value < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(value)).toLocaleString("en-US");
}

function lineChartOptions(staticImage, compact) {
  const tickFont = compact ? { size: 9 } : undefined;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    devicePixelRatio: staticImage ? 2 : window.devicePixelRatio || 1,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          boxWidth: compact ? 8 : 12,
          boxHeight: compact ? 8 : 12,
          padding: compact ? 4 : 12,
          font: compact ? { size: 9 } : undefined,
        },
      },
      tooltip: { enabled: !staticImage },
    },
    scales: {
      x: {
        type: "linear",
        min: 0,
        title: { display: !compact, text: "Month" },
        ticks: {
          maxTicksLimit: compact ? 4 : 6,
          font: tickFont,
          callback: (value) => String(Math.round(value)),
        },
      },
      y: {
        beginAtZero: true,
        ticks: { callback: moneyTick, font: tickFont },
      },
    },
  };
}

function applyChartFont() {
  if (typeof Chart === "undefined") return;
  Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
}

async function renderChart(startingBalance) {
  const token = ++chartToken;
  chartNote.textContent = "";
  interestChartNote.textContent = "";
  balanceChart = destroyChart(balanceChart);
  interestChart = destroyChart(interestChart);
  try {
    await loadScript(CHART_SRC);
  } catch (error) {
    if (token !== chartToken) return;
    const note = "The chart did not finish loading. Refresh the page and try again.";
    chartNote.textContent = note;
    interestChartNote.textContent = note;
    return;
  }
  if (token !== chartToken) return;
  if (typeof Chart === "undefined") {
    const note = "The chart did not finish loading. Refresh the page and try again.";
    chartNote.textContent = note;
    interestChartNote.textContent = note;
    return;
  }
  applyChartFont();

  balanceChart = new Chart(document.getElementById("balance-chart"), {
    type: "line",
    data: {
      datasets: lineDatasets((plan) => balanceChartPoints(plan, startingBalance)),
    },
    options: lineChartOptions(false),
  });
  interestChart = new Chart(document.getElementById("interest-chart"), {
    type: "line",
    data: {
      datasets: lineDatasets((plan) => interestChartPoints(plan)),
    },
    options: lineChartOptions(false),
  });
}

function renderStaticChart(kind, startingBalance, compact) {
  const host = document.createElement("div");
  const width = compact ? 340 : 680;
  const height = compact ? 188 : 280;
  host.style.cssText = "position:fixed;left:-8000px;top:0;width:" + width + "px;height:" + height + "px;background:#fff;";
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  const datasets = kind === "interest"
    ? lineDatasets((plan) => interestChartPoints(plan))
    : lineDatasets((plan) => balanceChartPoints(plan, startingBalance));
  const chart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: lineChartOptions(true, compact),
  });
  const url = canvas.toDataURL("image/png");
  chart.destroy();
  host.remove();
  return url;
}

function renderPlanSwitch() {
  planSwitch.hidden = viewPlans.length < 2;
  planSwitch.replaceChildren();
  viewPlans.forEach((plan) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.plan = plan.id;
    button.textContent = plan.name;
    const selected = plan.id === activePlanId;
    button.setAttribute("aria-pressed", String(selected));
    button.className = selected
      ? "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
      : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700";
    planSwitch.appendChild(button);
  });
}

function renderTable() {
  const plan = viewPlans.find((item) => item.id === activePlanId) || viewPlans[0];
  scheduleBody.replaceChildren();
  if (!plan) return;
  const fragment = document.createDocumentFragment();
  displaySchedule(plan).forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.className = row.已还 ? "paid-row" : (index % 2 === 1 ? "bg-slate-50" : "");
    [row.月份, formatMoney(row.月供), formatMoney(row.本金部分), formatMoney(row.利息部分), formatMoney(row.剩余本金)]
      .forEach((text, cellIndex) => {
        const cell = document.createElement("td");
        cell.className = cellIndex === 0
          ? "px-3 py-2 text-left"
          : "px-3 py-2 text-right";
        cell.textContent = text;
        tr.appendChild(cell);
      });
    fragment.appendChild(tr);
  });
  scheduleBody.appendChild(fragment);
}

function renderExportOptions() {
  const box = document.getElementById("export-plan-options");
  box.replaceChildren();
  viewPlans.forEach((plan) => {
    const label = document.createElement("label");
    label.className = "inline-flex items-center gap-2 text-sm text-slate-700";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = plan.id;
    input.checked = true;
    input.className = "size-4 accent-slate-900";
    label.append(input, document.createTextNode(plan.name));
    box.append(label);
  });
}

function buildCsv(plan) {
  const lines = ["Payment,Amount,Principal,Interest,Balance"];
  displaySchedule(plan).forEach((row) => {
    lines.push([
      row.月份,
      row.月供.toFixed(2),
      row.本金部分.toFixed(2),
      row.利息部分.toFixed(2),
      row.剩余本金.toFixed(2),
    ].join(","));
  });
  return lines.join("\r\n");
}

function exportSelectedPlans() {
  const selected = new Set(
    [...document.querySelectorAll("#export-plan-options input:checked")].map((input) => input.value)
  );
  const plans = viewPlans.filter((plan) => selected.has(plan.id));
  if (!plans.length) {
    message.textContent = "Select at least one schedule";
    return;
  }
  message.textContent = "";
  const csv = "\uFEFF" + plans.map((plan) => plan.name + "\r\n" + buildCsv(plan)).join("\r\n\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = plans.length === 1 ? "amortization-" + plans[0].name + ".csv" : "amortization-schedules.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function formatReportDate(date) {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function pdfEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pdfFacts(report) {
  const method = report.repayMethod === "principal" ? "Equal principal" : "Fixed payment";
  const paid = report.paid > 0 ? report.paid + " payments already made" : "";
  const loan = report.arm
    ? report.arm.fixedYears + "-year ARM, then " + report.arm.adjustedPercent + "%"
    : "Fixed-rate";
  return [
    loan,
    method,
    formatMoney(report.principal),
    report.ratePercent + "%",
    report.years + " years",
    paid,
  ].filter(Boolean).join("  ·  ");
}

function pdfActionLine(report) {
  const parts = [];
  const prepay = report.prepay || 0;
  if (prepay > 0) parts.push("Extra principal " + formatMoney(prepay));
  report.extras.forEach((item) => {
    if (prepay > 0 && item.月份 === 1 && item.金额 === prepay) return;
    parts.push("Payment " + item.月份 + ": extra principal " + formatMoney(item.金额));
  });
  if (report.biweekly) parts.push("Bi-weekly " + formatMoney(report.biweekly.biweeklyPayment));
  if (report.housing && report.housing.monthlyEscrow > 0) {
    parts.push("PMI " + formatMoney(report.housing.pmi) + ", tax " + formatMoney(report.housing.propertyTax) + "/yr, insurance " + formatMoney(report.housing.insurance) + "/yr");
  }
  if (report.opportunity) {
    parts.push("Cash on hand " + formatMoney(report.opportunity.cash) + " at " + report.opportunity.depositRatePercent + "% APY");
  }
  if (report.refinance) parts.push("Refinance rate " + report.refinance.ratePercent + "%");
  return parts.join("  ·  ");
}

function pdfProgress(percent) {
  const bar = pdfEl("div", "interest-bar");
  const fill = document.createElement("span");
  fill.style.width = percent + "%";
  bar.append(fill);
  return bar;
}

function pdfTermText(report) {
  return formatTerm(report.years * 12);
}

function pdfStat(label, value, className, sub) {
  const node = pdfEl("div", className ? "pdf-stat " + className : "pdf-stat");
  node.append(pdfEl("span", "", label), pdfEl("strong", "", value));
  if (sub) node.append(pdfEl("em", "", sub));
  return node;
}

function pdfSummary(report) {
  const card = pdfEl("section", "pdf-summary");
  const summary = report.interestSummary;
  const housing = report.housing || { pmi: 0, taxMonthly: 0, insuranceMonthly: 0 };
  card.append(pdfStat("Monthly housing payment", formatMoney(report.monthlyHousing || report.originalPayment), "pdf-stat-lg"));
  const payments = pdfEl("div", "pdf-pair");
  payments.append(
    pdfStat("Principal & interest", formatMoney(report.originalPayment)),
    pdfStat("PMI", formatMoney(housing.pmi)),
    pdfStat("Property tax", formatMoney(housing.taxMonthly)),
    pdfStat("Home insurance", formatMoney(housing.insuranceMonthly))
  );
  card.append(payments);
  if (report.biweekly) {
    card.append(pdfEl("p", "pdf-caption", "Bi-weekly principal and interest " + formatMoney(report.biweekly.biweeklyPayment) + ". Saves " + formatMoney(report.biweekly.savedInterest) + " and " + report.biweekly.monthsSaved + " months versus monthly payments."));
  }
  card.append(pdfStat("Total interest", formatMoney(summary.full), "pdf-stat-md"));
  if (report.paid > 0) {
    const percent = interestProgress(summary);
    const line = pdfEl("div", "pdf-remain");
    line.append(
      pdfEl("span", "", "Interest remaining " + formatMoney(summary.remaining)),
      pdfEl("span", "", percent + "% paid")
    );
    card.append(line, pdfProgress(percent));
  } else {
    card.append(pdfStat("Loan term", pdfTermText(report), "pdf-stat-gap"));
  }
  return card;
}

function pdfBar(name, amount, maxAbs, color, best) {
  const row = pdfEl("div", "pdf-bar-row");
  row.append(pdfEl("span", best ? "pdf-bar-name is-best" : "pdf-bar-name", name));
  const track = pdfEl("span", "pdf-bar-track");
  const fill = document.createElement("span");
  const width = maxAbs > 0 ? Math.abs(amount) / maxAbs * 100 : 0;
  fill.style.width = (amount === 0 ? 0 : Math.max(width, 1.5)) + "%";
  fill.style.background = color;
  track.append(fill);
  const value = pdfEl("span", "pdf-bar-value", formatBenefit(amount));
  value.style.color = color;
  row.append(track, value);
  return row;
}

function pdfBenefit(report) {
  const section = pdfEl("section", "pdf-section");
  section.append(pdfEl("h2", "", "Net benefit"));
  const rows = report.comparison || [];
  if (rows.length < 2) {
    section.append(pdfEl("p", "pdf-caption", "Only the original plan is shown. Add extra principal, bi-weekly payments, cash on hand, or a refinance to compare interest."));
    return section;
  }
  const maxAbs = rows.reduce((max, row) => Math.max(max, Math.abs(row.benefit)), 0);
  const colors = {
    best: "#047857",
    second: "#0369a1",
    ok: "#475569",
    base: "#94a3b8",
    bad: "#e11d48",
  };
  rows.forEach((row) => {
    const name = row.tone === "best"
      ? row.name + " · Best"
      : row.tone === "second"
        ? row.name + " · Next"
        : row.name;
    section.append(pdfBar(name, row.benefit, maxAbs, colors[row.tone] || "#475569", row.tone === "best"));
  });
  section.append(pdfEl("p", "pdf-caption", "Bar length follows the absolute net benefit. A positive amount is interest saved versus the original plan."));
  return section;
}

function chartStartingBalance(report) {
  const original = viewPlans.find((plan) => plan.id === "original");
  if (!original || !original.schedule.length) return report.principal;
  const row = original.schedule[0];
  return roundMoney(row.剩余本金 + row.本金部分);
}

async function pdfCharts(report) {
  const section = pdfEl("section", "pdf-section");
  section.append(pdfEl("h2", "", "Payoff trend"));
  if (typeof Chart === "undefined" || !viewPlans.length) {
    section.append(pdfEl("p", "pdf-caption", "The trend chart needs Chart.js. The net-benefit bars above still compare the strategies."));
    return section;
  }
  applyChartFont();
  const start = chartStartingBalance(report);
  const grid = pdfEl("div", "pdf-charts");
  const charts = [
    ["Remaining balance", "balance"],
    ["Remaining interest", "interest"],
  ];
  for (const [title, kind] of charts) {
    const card = pdfEl("div", "pdf-chart-card");
    card.append(pdfEl("h3", "", title));
    const image = pdfEl("img", "pdf-chart");
    image.alt = title;
    image.src = renderStaticChart(kind, start, true);
    if (image.decode) await image.decode().catch(() => {});
    card.append(image);
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function pdfOpportunity(report) {
  const item = report.opportunity;
  const outcome = item.result;
  const section = pdfEl("section", "pdf-panel");
  section.append(pdfEl("h2", "", "Where the cash goes"));
  const rows = [
    ["Shorter term", outcome.缩短节省利息, "#b45309"],
    ["Lower payment", outcome.减供节省利息, "#7c3aed"],
    ["Compounded savings", outcome.存款收益, "#0f172a"],
  ];
  const maxAbs = Math.max(...rows.map((row) => Math.abs(row[1])), 1);
  rows.forEach((row) => section.append(pdfBar(row[0], row[1], maxAbs, row[2], false)));
  const prepayBest = Math.max(outcome.缩短节省利息, outcome.减供节省利息);
  const diff = roundMoney(Math.abs(prepayBest - outcome.存款收益));
  let verdict = "Paying extra and saving earn the same amount";
  if (prepayBest > outcome.存款收益) verdict = "Paying extra beats saving by " + formatMoney(diff);
  if (outcome.存款收益 > prepayBest) verdict = "Saving beats paying extra by " + formatMoney(diff);
  section.append(pdfEl("p", "pdf-caption", item.depositRatePercent + "% APY grows to " + formatMoney(outcome.到期金额) + ". " + verdict + "."));
  return section;
}

function pdfRefinance(report) {
  const item = report.refinance;
  const outcome = item.result;
  const section = pdfEl("section", "pdf-panel");
  section.append(pdfEl("h2", "", "Refinance"));
  const grid = pdfEl("div", "pdf-mini");
  [
    ["New payment", formatMoney(outcome.新月供)],
    ["Net benefit", formatBenefit(roundMoney(outcome.节省利息 - item.fee))],
    ["Break-even", formatPayback(outcome)],
  ].forEach(([label, value]) => {
    const box = pdfEl("div", "pdf-mini-item");
    box.append(pdfEl("span", "", label), pdfEl("strong", "", value));
    grid.append(box);
  });
  section.append(grid);
  section.append(pdfEl("p", "pdf-caption", "The remaining term stays the same. New rate " + item.ratePercent + "%, closing costs " + formatMoney(item.fee) + "."));
  return section;
}

function pdfSide(report) {
  const parts = [];
  if (report.opportunity) parts.push(pdfOpportunity(report));
  if (report.refinance) parts.push(pdfRefinance(report));
  if (!parts.length) return null;
  const wrap = pdfEl("div", parts.length === 2 ? "pdf-split" : "pdf-split pdf-split-one");
  parts.forEach((part) => wrap.append(part));
  return wrap;
}

async function buildPdfSheet(report, dateText) {
  const sheet = pdfEl("div", "pdf-sheet");
  const top = pdfEl("div", "pdf-top");
  const titles = pdfEl("div", "");
  titles.append(pdfEl("h1", "", "Mortgage payoff report"));
  titles.append(pdfEl("p", "pdf-kicker", pdfFacts(report)));
  const action = pdfActionLine(report);
  if (action) titles.append(pdfEl("p", "pdf-kicker", action));
  top.append(titles, pdfEl("span", "pdf-date", dateText));
  sheet.append(top, pdfSummary(report), pdfBenefit(report));
  sheet.append(await pdfCharts(report));
  const side = pdfSide(report);
  if (side) sheet.append(side);
  sheet.append(pdfEl("p", "pdf-foot", "Net benefit uses interest still to be paid. Refinance is shown after closing costs. Charts start with the next payment and leave out payments already made."));
  return sheet;
}

async function capturePdfNode(host, node) {
  host.replaceChildren(node);
  return html2canvas(host, {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    onclone(doc) {
      const root = doc.querySelector(".pdf-root");
      if (!root) return;
      root.style.position = "absolute";
      root.style.left = "0";
      root.style.top = "0";
    },
  });
}

async function createPdfReport() {
  if (!latestReport) throw new Error("Calculate a loan before exporting");
  try {
    await Promise.all([
      loadScript(HTML2CANVAS_SRC),
      loadScript(JSPDF_SRC),
      loadScript(CHART_SRC).catch(() => {}),
    ]);
  } catch (error) {
    throw new Error("The PDF tools did not finish loading. Refresh the page and try again.");
  }
  if (typeof html2canvas !== "function" || !window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("The PDF tools did not finish loading. Refresh the page and try again.");
  }
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const host = pdfEl("div", "pdf-root");
  document.body.appendChild(host);
  try {
    const sheet = await buildPdfSheet(latestReport, formatReportDate(new Date()));
    const canvas = await capturePdfNode(host, sheet);
    const pageWidth = 186;
    const pageHeight = 277;
    let drawWidth = pageWidth;
    let drawHeight = canvas.height * pageWidth / canvas.width;
    if (drawHeight > pageHeight) {
      drawHeight = pageHeight;
      drawWidth = canvas.width * pageHeight / canvas.height;
    }
    const x = 12 + (pageWidth - drawWidth) / 2;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, 10, drawWidth, drawHeight);
  } finally {
    host.remove();
  }
  return pdf;
}
