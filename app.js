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
const HTML2CANVAS_SRC = "https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js";
const JSPDF_SRC = "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js";
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
  button.textContent = "正在生成…";
  createPdfReport()
    .then((pdf) => pdf.save("房贷月供报告.pdf"))
    .catch((error) => {
      message.textContent = error.message || "生成 PDF 失败";
    })
    .finally(() => {
      button.disabled = false;
      button.textContent = "导出PDF报告";
    });
});

document.getElementById("add-extra").addEventListener("click", () => {
  addExtraRow();
});
bindAmountInput(document.getElementById("principal"));
bindAmountInput(document.getElementById("spare"));
bindAmountInput(document.getElementById("refi-fee"));
bindAmountInput(document.getElementById("fund-principal"));
bindAmountInput(document.getElementById("commercial-principal"));
bindAmountInput(document.getElementById("combo-prepay"));
bindAmountInput(document.getElementById("prepay"));

const modeSingleButton = document.getElementById("mode-single");
const modeComboButton = document.getElementById("mode-combo");
const singleFields = document.getElementById("single-fields");
const comboFields = document.getElementById("combo-fields");
const comboBreakdown = document.getElementById("combo-breakdown");
const comboExtraNote = document.getElementById("combo-extra");
let loanMode = "single";
const modeButtonOn = "rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white";
const modeButtonOff = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800";

modeSingleButton.addEventListener("click", () => setLoanMode("single"));
modeComboButton.addEventListener("click", () => setLoanMode("combo"));

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
["years", "fund-years", "commercial-years", "paid-months"].forEach((id) => {
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
    message.textContent = "请先填写必填项：" + missing.map((item) => item[1]).join("、");
    message.scrollIntoView({ block: "nearest" });
    document.getElementById(missing[0][0]).focus();
    return;
  }

  try {
    let years;
    let extras;
    let paid = 0;
    if (loanMode === "combo") {
      years = null;
      extras = null;
    } else {
      years = readYears("years", "贷款年限");
      paid = readPaidMonths(years * 12);
      extras = readExtras(years, paid);
    }
    const opportunityInput = readOpportunity();
    const refinanceInput = readRefinance();
    let principal;
    let rate;
    let ratePercent;
    let original;
    let combo = null;
    let comboInput = null;
    let planExtras = extras;
    let singlePrepay = 0;

    if (loanMode === "combo") {
      comboInput = readCombo();
      years = Math.max(comboInput.fundYears, comboInput.commercialYears);
      paid = readPaidMonths(years * 12);
      extras = readExtras(years, paid);
      planExtras = extras.slice();
      if (comboInput.prepay > 0) planExtras.push({ 月份: 1, 金额: comboInput.prepay });
      combo = calcComboLoan({
        fundPrincipal: comboInput.fund,
        fundRate: comboInput.fundRate / 100,
        fundYears: comboInput.fundYears,
        commercialPrincipal: comboInput.commercial,
        commercialRate: comboInput.commercialRate / 100,
        commercialYears: comboInput.commercialYears,
        extraPayments: planExtras,
        method: repayMethod,
        elapsed: paid,
      });
      principal = roundMoney(comboInput.fund + comboInput.commercial);
      rate = null;
      ratePercent = null;
      original = combo.原计划;
    } else {
      principal = readWan("principal");
      ratePercent = readNumber("rate");
      rate = ratePercent / 100;
      singlePrepay = readOptionalPrepay("prepay");
      planExtras = extras.slice();
      if (singlePrepay > 0) planExtras.push({ 月份: 1, 金额: singlePrepay });
      original = amortize(repayMethod).base(principal, rate, years, null, paid);
    }

    const originalInterest = combo ? combo.总利息 : sumInterest(original);
    const originalPayment = combo ? combo.总月供 : original[0].月供;
    const interestSummary = buildInterestSummary({
      combo,
      comboInput,
      original,
      principal,
      rate,
      years,
      paid,
    });

    payment.textContent = formatYuan(originalPayment);
    renderInterestSplit(interestSummary);
    renderComboSummary(combo);

    let shortened = null;
    let reduced = null;
    if (combo) {
      shortened = combo.优先商贷 ? combo.优先商贷.计划 : null;
      reduced = combo.优先商贷减少月供 ? combo.优先商贷减少月供.计划 : null;
    } else if (planExtras.length > 0) {
      const calc = amortize(repayMethod);
      shortened = calc.base(principal, rate, years, planExtras, paid);
      reduced = calc.reduce(principal, rate, years, planExtras, paid);
    }
    const opportunity = opportunityInput
      ? loanMode === "combo"
        ? opportunityFromCombo(comboInput, opportunityInput.cash, opportunityInput.ratePercent / 100, repayMethod, paid)
        : calcOpportunity(principal, rate, years, opportunityInput.cash, opportunityInput.ratePercent / 100, repayMethod, paid)
      : null;
    const refinance = refinanceInput
      ? loanMode === "combo"
        ? calcComboRefinance(
          comboInput.fund,
          comboInput.fundRate / 100,
          comboInput.fundYears,
          comboInput.commercial,
          comboInput.commercialRate / 100,
          comboInput.commercialYears,
          refinanceInput.ratePercent / 100,
          refinanceInput.fee,
          repayMethod,
          paid
        )
        : calcRefinance(principal, rate, years, refinanceInput.ratePercent / 100, refinanceInput.fee, repayMethod, paid)
      : null;
    const comparisonRows = buildComparisonRows({
      original,
      originalInterest,
      originalPayment,
      extras: planExtras,
      shortened,
      reduced,
      opportunity,
      refinance,
      combo: Boolean(combo && combo.优先商贷),
      comboExtraSaved: combo ? combo.额外节省利息 : 0,
      commercialEnd: combo && combo.优先商贷 ? combo.优先商贷.商贷还清月份 : null,
      fundEnd: combo && combo.优先商贷 ? combo.优先商贷.公积金还清月份 : null,
      commercialMonths: combo ? combo.商贷月数 : null,
      fundMonths: combo ? combo.公积金月数 : null,
      fundYears: comboInput ? comboInput.fundYears : null,
      commercialYears: comboInput ? comboInput.commercialYears : null,
      fundFirst: combo ? combo.优先公积金 : null,
      methodLabel: repayMethod === "principal" ? "等额本金" : "等额本息",
    });
    renderComparison(comparisonRows);
    result.hidden = false;
    const startingBalance = roundMoney(original[0].剩余本金 + original[0].本金部分);
    showPlans(startingBalance, chartPlans({
      original,
      shortened,
      reduced,
      fundFirst: combo ? combo.优先公积金 : null,
      opportunity,
      refinance,
      combo: Boolean(combo),
    }));
    latestReport = {
      principal,
      ratePercent,
      years,
      extras: planExtras.slice(),
      combo: combo && comboInput
        ? {
          fundPrincipal: comboInput.fund,
          fundRatePercent: comboInput.fundRate,
          fundYears: comboInput.fundYears,
          commercialPrincipal: comboInput.commercial,
          commercialRatePercent: comboInput.commercialRate,
          commercialYears: comboInput.commercialYears,
          fundPayment: combo.公积金月供,
          commercialPayment: combo.商贷月供,
          fundInterest: interestSummary.fundFull,
          commercialInterest: interestSummary.commercialFull,
          fundRemainingInterest: interestSummary.fundRemaining,
          commercialRemainingInterest: interestSummary.commercialRemaining,
          extraSaved: combo.额外节省利息,
          priorityNote: comboPriorityNote(combo),
          prepay: comboInput.prepay,
        }
        : null,
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
    '<label class="block text-sm font-medium text-slate-700">在多少期时还款<input class="extra-remaining ' + fieldClass + '" type="text" inputmode="numeric" placeholder="例如 120" autocomplete="off"></label>',
    '<label class="block text-sm font-medium text-slate-700">还多少钱（万元）<input class="extra-amount ' + fieldClass + '" type="text" inputmode="decimal" placeholder="例如 10" autocomplete="off"></label>',
    '<button type="button" class="remove justify-self-start text-sm font-medium text-rose-700 sm:col-span-2">删除</button>',
  ].join("");
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  bindAmountInput(row.querySelector(".extra-amount"));
  extraList.appendChild(row);
  return row;
}

function setLoanMode(mode) {
  loanMode = mode;
  const combo = mode === "combo";
  singleFields.hidden = combo;
  comboFields.hidden = !combo;
  modeSingleButton.className = combo ? modeButtonOff : modeButtonOn;
  modeComboButton.className = combo ? modeButtonOn : modeButtonOff;
  document.getElementById("principal").required = !combo;
  document.getElementById("rate").required = !combo;
  document.getElementById("years").required = !combo;
  document.getElementById("years-field").hidden = combo;
  document.getElementById("single-prepay").hidden = combo;
  ["fund-principal", "fund-rate", "fund-years", "commercial-principal", "commercial-rate", "commercial-years"].forEach((id) => {
    document.getElementById(id).required = combo;
  });
  markMissingFields([]);
  refreshRemaining();
}

function missingRequiredFields() {
  const fields = loanMode === "combo"
    ? [
      ["fund-principal", "公积金贷款金额（万元）"],
      ["fund-rate", "公积金年利率（%）"],
      ["fund-years", "公积金年限"],
      ["commercial-principal", "商贷金额（万元）"],
      ["commercial-rate", "商贷年利率（%）"],
      ["commercial-years", "商贷年限"],
    ]
    : [
      ["principal", "贷款总额（万元）"],
      ["rate", "年利率（%）"],
      ["years", "贷款年限"],
    ];
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
  methodBadge.textContent = principal ? "等额本金" : "等额本息";
}

function readCombo() {
  const fund = readWan("fund-principal");
  const fundRate = readNumber("fund-rate");
  const commercial = readWan("commercial-principal");
  const commercialRate = readNumber("commercial-rate");
  const fundYears = readYears("fund-years", "公积金年限");
  const commercialYears = readYears("commercial-years", "商贷年限");
  if (!Number.isFinite(fund) || roundMoney(fund) <= 0) {
    throw new Error("公积金贷款金额必须是大于 0 的数字");
  }
  if (!Number.isFinite(fundRate) || fundRate < 0) {
    throw new Error("公积金利率必须是大于等于 0 的数字");
  }
  if (!Number.isFinite(commercial) || roundMoney(commercial) <= 0) {
    throw new Error("商贷金额必须是大于 0 的数字");
  }
  if (!Number.isFinite(commercialRate) || commercialRate < 0) {
    throw new Error("商贷利率必须是大于等于 0 的数字");
  }
  const prepayRaw = document.getElementById("combo-prepay").value.trim();
  let prepay = 0;
  if (prepayRaw !== "") {
    prepay = Number(prepayRaw.replace(/,/g, ""));
    if (!Number.isFinite(prepay) || prepay < 0) {
      throw new Error("提前还款金额必须是大于等于 0 的数字");
    }
    prepay = wanToYuan(prepay);
  }
  return {
    fund: roundMoney(fund),
    fundRate,
    fundYears,
    commercial: roundMoney(commercial),
    commercialRate,
    commercialYears,
    prepay,
  };
}

function buildInterestSummary(input) {
  const paid = input.paid || 0;
  if (input.combo) {
    const fundRemaining = input.combo.公积金总利息;
    const commercialRemaining = input.combo.商贷总利息;
    const remaining = input.combo.总利息;
    if (paid <= 0) {
      rememberPaidHistory(input.original, 0);
      return {
        paid,
        combo: true,
        full: remaining,
        remaining,
        fundFull: fundRemaining,
        fundRemaining,
        commercialFull: commercialRemaining,
        commercialRemaining,
      };
    }
    const fullCombo = calcComboLoan({
      fundPrincipal: input.comboInput.fund,
      fundRate: input.comboInput.fundRate / 100,
      fundYears: input.comboInput.fundYears,
      commercialPrincipal: input.comboInput.commercial,
      commercialRate: input.comboInput.commercialRate / 100,
      commercialYears: input.comboInput.commercialYears,
      extraPayments: [],
      method: repayMethod,
      elapsed: 0,
    });
    rememberPaidHistory(fullCombo.原计划, paid);
    return {
      paid,
      combo: true,
      full: fullCombo.总利息,
      remaining,
      fundFull: fullCombo.公积金总利息,
      fundRemaining,
      commercialFull: fullCombo.商贷总利息,
      commercialRemaining,
    };
  }
  const remaining = sumInterest(input.original);
  if (paid <= 0) {
    rememberPaidHistory(input.original, 0);
    return { paid, combo: false, full: remaining, remaining };
  }
  const full = amortize(repayMethod).base(input.principal, input.rate, input.years);
  rememberPaidHistory(full, paid);
  return { paid, combo: false, full: sumInterest(full), remaining };
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
  document.getElementById("original-interest").textContent = formatYuan(summary.full);
  const wrap = document.getElementById("interest-progress-wrap");
  const box = document.getElementById("interest-breakdown");
  const note = document.getElementById("schedule-paid-note");
  if (summary.paid > 0) {
    const percent = interestProgress(summary);
    wrap.hidden = false;
    document.getElementById("remaining-interest").textContent = formatYuan(summary.remaining);
    document.getElementById("interest-percent").textContent = "已还 " + percent + "%";
    const bar = document.getElementById("interest-progress");
    bar.style.width = percent + "%";
    bar.parentElement.setAttribute("aria-valuenow", String(percent));
    bar.parentElement.setAttribute("aria-valuemin", "0");
    bar.parentElement.setAttribute("aria-valuemax", "100");
    note.textContent = "着色的行是已还的 " + summary.paid + " 期";
  } else {
    wrap.hidden = true;
    note.textContent = "";
  }
  if (!summary.combo) {
    box.hidden = true;
    return;
  }
  document.getElementById("fund-interest").textContent = formatYuan(summary.fundFull);
  document.getElementById("commercial-interest").textContent = formatYuan(summary.commercialFull);
  document.getElementById("fund-remaining-interest").textContent = summary.paid > 0
    ? "剩余 " + formatYuan(summary.fundRemaining)
    : "";
  document.getElementById("commercial-remaining-interest").textContent = summary.paid > 0
    ? "剩余 " + formatYuan(summary.commercialRemaining)
    : "";
  box.hidden = false;
}

function refreshRemaining() {
  const box = document.getElementById("remaining-months");
  const paidRaw = document.getElementById("paid-months").value.trim();
  const paid = paidRaw === "" ? 0 : Number(paidRaw);
  const paidOk = Number.isInteger(paid) && paid >= 0;
  if (!paidOk) {
    box.textContent = "已还款期数不正确";
    return;
  }
  if (loanMode === "combo") {
    const fundYears = readNumber("fund-years");
    const commercialYears = readNumber("commercial-years");
    if (!Number.isInteger(fundYears) || fundYears <= 0 || !Number.isInteger(commercialYears) || commercialYears <= 0) {
      box.textContent = "填写年限后显示";
      return;
    }
    box.textContent = "公积金 " + formatRemaining(fundYears * 12, paid) + "\n商贷 " + formatRemaining(commercialYears * 12, paid);
    return;
  }
  const years = readNumber("years");
  if (!Number.isInteger(years) || years <= 0) {
    box.textContent = "填写年限后显示";
    return;
  }
  box.textContent = formatRemaining(years * 12, paid);
}

function formatRemaining(total, paid) {
  const left = total - paid;
  if (left <= 0) return "已还清";
  return left + " 期";
}

function readPaidMonths(maxMonths) {
  const raw = document.getElementById("paid-months").value.trim();
  if (raw === "") return 0;
  const paid = Number(raw);
  if (!Number.isInteger(paid) || paid < 0) {
    throw new Error("已还款期数必须是大于等于 0 的整数");
  }
  if (paid >= maxMonths) {
    throw new Error("已还款期数要小于贷款期数 " + maxMonths);
  }
  return paid;
}

function comboPriorityNote(combo) {
  if (!combo || !combo.优先商贷) return "";
  const extra = combo.额外节省利息;
  if (extra > 0) return "优先还商贷，比先还公积金多省 " + formatYuan(extra) + " 利息";
  if (extra < 0) return "按这两笔利率，先还公积金比先还商贷多省 " + formatYuan(-extra) + " 利息";
  return "先还商贷和先还公积金省下的利息相同";
}

function renderComboSummary(combo) {
  if (!combo) {
    comboBreakdown.hidden = true;
    comboExtraNote.hidden = true;
    comboExtraNote.textContent = "";
    return;
  }
  document.getElementById("fund-payment").textContent = formatYuan(combo.公积金月供);
  document.getElementById("commercial-payment").textContent = formatYuan(combo.商贷月供);
  comboBreakdown.hidden = false;
  const note = comboPriorityNote(combo);
  comboExtraNote.hidden = note === "";
  comboExtraNote.textContent = note;
}

function opportunityFromCombo(comboInput, cash, depositRate, method, elapsed) {
  const result = calcComboLoan({
    fundPrincipal: comboInput.fund,
    fundRate: comboInput.fundRate / 100,
    fundYears: comboInput.fundYears,
    commercialPrincipal: comboInput.commercial,
    commercialRate: comboInput.commercialRate / 100,
    commercialYears: comboInput.commercialYears,
    extraPayments: [{ 月份: 1, 金额: cash }],
    method,
    elapsed,
  });
  const deposit = calcDepositGrowth(cash, depositRate, result.原期数);
  return {
    缩短节省利息: result.优先商贷.节省利息,
    缩短月供: result.总月供,
    还清月份: result.优先商贷.还清月份,
    提前月数: result.原期数 - result.优先商贷.还清月份,
    减供节省利息: result.优先商贷减少月供.节省利息,
    减供月供: result.优先商贷减少月供.之后月供,
    减供期数: result.优先商贷减少月供.计划.length,
    商贷还清月份: result.优先商贷.商贷还清月份,
    公积金还清月份: result.优先商贷.公积金还清月份,
    商贷月数: result.商贷月数,
    公积金月数: result.公积金月数,
    原期数: result.原期数,
    存款收益: deposit.收益,
    到期金额: deposit.到期金额,
    缩短计划: result.优先商贷.计划,
    减供计划: result.优先商贷减少月供.计划,
  };
}

function comboPriorityDetail(extraSaved) {
  if (extraSaved > 0) return "比先还公积金多省 " + formatYuan(extraSaved);
  if (extraSaved < 0) return "比先还公积金少省 " + formatYuan(-extraSaved);
  return "和先还公积金省的利息相同";
}

function partEndText(commercialMonth, fundMonth) {
  return "商贷 " + formatTerm(commercialMonth).replace(/ /g, "") + "还清 · 公积金 " + formatTerm(fundMonth).replace(/ /g, "") + "还清";
}

function readOptionalPrepay(id) {
  const raw = document.getElementById(id).value.trim();
  if (raw === "") return 0;
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("提前还款金额必须是大于等于 0 的数字");
  }
  return wanToYuan(value);
}

function readExtras(years, paid) {
  const totalMonths = years * 12;
  const elapsed = paid || 0;
  const extras = [];
  let index = 0;
  extraList.querySelectorAll(".extra-row").forEach((row) => {
    const periodRaw = row.querySelector(".extra-remaining").value.trim();
    const amountRaw = row.querySelector(".extra-amount").value.trim().replace(/,/g, "");
    if (periodRaw === "" && amountRaw === "") return;
    index += 1;
    const period = Number(periodRaw);
    const firstPeriod = elapsed + 1;
    if (!Number.isInteger(period) || period < firstPeriod || period > totalMonths) {
      throw new Error("第 " + index + " 条分批还款的期数要在 " + firstPeriod + " 到 " + totalMonths + " 之间");
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("第 " + index + " 条分批还款的金额必须大于 0");
    }
    extras.push({
      月份: period - elapsed,
      金额: wanToYuan(amount),
    });
  });
  return extras;
}

function readOpportunity() {
  const cashRaw = document.getElementById("spare").value.trim();
  const rateRaw = document.getElementById("deposit-rate").value.trim();
  if (cashRaw === "" && rateRaw === "") return null;
  if (cashRaw === "" || rateRaw === "") {
    throw new Error("机会成本对比需要同时填写闲钱金额和年化利率");
  }
  const cash = wanToYuan(Number(cashRaw.replace(/,/g, "")));
  const ratePercent = Number(rateRaw);
  if (!Number.isFinite(cash) || roundMoney(cash) <= 0) {
    throw new Error("手头闲钱必须是大于 0 的数字");
  }
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    throw new Error("存款或理财年化利率必须是大于等于 0 的数字");
  }
  return { cash, ratePercent };
}

function formatBenefit(amount) {
  const text = formatYuan(Math.abs(amount));
  if (amount > 0) return "+" + text;
  if (amount < 0) return "-" + text;
  return text;
}

function readRefinance() {
  const rateRaw = document.getElementById("refi-rate").value.trim();
  const feeRaw = document.getElementById("refi-fee").value.trim();
  if (rateRaw === "" && feeRaw === "") return null;
  if (rateRaw === "") throw new Error("用新贷还旧贷需要填写新贷款年利率");
  const ratePercent = Number(rateRaw);
  const fee = feeRaw === "" ? 0 : roundMoney(Number(feeRaw.replace(/,/g, "")));
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    throw new Error("新贷款年利率必须是大于等于 0 的数字");
  }
  if (!Number.isFinite(fee) || roundMoney(fee) < 0) {
    throw new Error("转贷手续费必须是大于等于 0 的数字");
  }
  return { ratePercent, fee: roundMoney(fee) };
}

function formatPayback(result) {
  if (result.手续费 <= 0) return "无手续费";
  if (result.回本月数 == null) return "期限内无法回本";
  return formatTerm(result.回本月数);
}

function formatSavedInterest(saved) {
  if (saved < 0) return "多付 " + formatYuan(-saved);
  return formatYuan(saved);
}

function buildComparisonRows(input) {
  const totalMonths = input.original.length;
  const rows = [{
    name: "原计划",
    note: input.fundYears
      ? input.methodLabel + "，公积金" + input.fundYears + "年，商贷" + input.commercialYears + "年"
      : input.methodLabel + "，按当前利率还满" + formatTerm(totalMonths).replace(/ /g, ""),
    benefit: 0,
    order: 50,
  }];
  if (input.shortened) {
    const lines = input.combo
      ? comboShortenNotes(input.commercialMonths, input.commercialEnd, input.fundMonths, input.fundEnd)
      : [shortenNote(totalMonths, input.shortened.length)];
    if (input.combo) lines.push(comboPriorityDetail(input.comboExtraSaved));
    rows.push({
      name: input.combo ? "优先还商贷" : "提前还款缩短年限",
      note: lines.join("\n"),
      benefit: roundMoney(input.originalInterest - sumInterest(input.shortened)),
      order: 10,
    });
  }
  if (input.fundFirst) {
    rows.push({
      name: "优先还公积金",
      note: comboShortenNotes(input.commercialMonths, input.fundFirst.商贷还清月份, input.fundMonths, input.fundFirst.公积金还清月份).join("\n"),
      benefit: input.fundFirst.节省利息,
      order: 12,
    });
  }
  if (input.reduced) {
    const payment = reducedMonthlyPayment(input.reduced, input.extras, totalMonths, input.originalPayment);
    rows.push({
      name: input.combo ? "优先还商贷减少月供" : "提前还款减少月供",
      note: paymentChangeNote(input.originalPayment, payment),
      benefit: roundMoney(input.originalInterest - sumInterest(input.reduced)),
      order: 20,
    });
  }
  if (input.opportunity) {
    const item = input.opportunity;
    const shortenLines = item.商贷月数 != null
      ? comboShortenNotes(item.商贷月数, item.商贷还清月份, item.公积金月数, item.公积金还清月份)
      : [shortenNote(item.原期数, item.还清月份)];
    rows.push({
      name: "闲钱缩短年限",
      note: shortenLines.join("\n"),
      benefit: item.缩短节省利息,
      order: 30,
    });
    rows.push({
      name: "闲钱减少月供",
      note: paymentChangeNote(item.缩短月供, item.减供月供),
      benefit: item.减供节省利息,
      order: 35,
    });
    rows.push({
      name: "存款月复利",
      note: "到期 " + formatYuan(item.到期金额) + "，存" + formatTerm(item.原期数).replace(/ /g, ""),
      benefit: item.存款收益,
      order: 40,
    });
  }
  if (input.refinance) {
    const item = input.refinance;
    const lines = [paymentChangeNote(input.originalPayment, item.新月供)];
    if (item.组合) lines.push("公积金月供不变，商贷新月供 " + formatYuan(item.商贷新月供));
    lines.push("回本：" + formatPayback(item));
    if (item.手续费 > 0) lines.push("已扣手续费 " + formatYuan(item.手续费));
    rows.push({
      name: "转贷",
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
    throw new Error(label + "必须是大于 0 的整数");
  }
  return years;
}

function monthsShortened(total, end) {
  if (end == null || !Number.isFinite(end)) return 0;
  return Math.max(0, total - end);
}

function shortenNote(total, end, part) {
  const months = monthsShortened(total, end);
  const name = part || "";
  if (months <= 0) return name + "年限未缩短";
  return name + "缩短了 " + months + " 个月";
}

function comboShortenNotes(commercialMonths, commercialEnd, fundMonths, fundEnd) {
  const lines = [];
  if (monthsShortened(commercialMonths, commercialEnd) > 0) lines.push(shortenNote(commercialMonths, commercialEnd, "商贷"));
  if (monthsShortened(fundMonths, fundEnd) > 0) lines.push(shortenNote(fundMonths, fundEnd, "公积金"));
  if (!lines.length) lines.push("年限未缩短");
  return lines;
}

function paymentChangeNote(before, after) {
  const drop = roundMoney(before - after);
  if (drop > 0) return "月供减少了 " + formatYuan(drop);
  if (drop < 0) return "月供增加了 " + formatYuan(-drop);
  return "月供未减少";
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
    best: "最优",
    second: "次优",
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
  if (years === 0) return months + " 个月";
  if (months === 0) return years + " 年";
  return years + " 年 " + months + " 个月";
}

function sumInterest(schedule) {
  return roundMoney(schedule.reduce((sum, row) => sum + row.利息部分, 0));
}

function readNumber(id) {
  const raw = document.getElementById(id).value.trim().replace(/,/g, "");
  if (raw === "") return NaN;
  return Number(raw);
}

function wanToYuan(wan) {
  return roundMoney(wan * 10000);
}

function readWan(id) {
  const wan = readNumber(id);
  if (!Number.isFinite(wan)) return wan;
  return wanToYuan(wan);
}

function formatAmountInput(value) {
  const cleaned = value.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (cleaned === "") return "";
  const dot = cleaned.indexOf(".");
  let intPart = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const hasDot = dot !== -1;
  const fraction = hasDot ? cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 4) : "";
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return hasDot ? grouped + "." + fraction : grouped;
}

function bindAmountInput(input) {
  input.addEventListener("input", () => {
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const logicalBefore = input.value.slice(0, start).replace(/,/g, "").length;
    const formatted = formatAmountInput(input.value);
    input.value = formatted;
    let seen = 0;
    let pos = 0;
    while (pos < formatted.length && seen < logicalBefore) {
      if (formatted[pos] !== ",") seen += 1;
      pos += 1;
    }
    input.setSelectionRange(pos, pos);
  });
  input.addEventListener("blur", () => {
    input.value = formatAmountInput(input.value.replace(/\.$/, ""));
  });
}

function formatYuan(amount) {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 100000000) {
    return sign + (abs / 100000000).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " 亿元";
  }
  if (abs >= 100000) {
    return sign + (abs / 10000).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " 万元";
  }
  return sign + Math.round(abs).toLocaleString("zh-CN") + " 元";
}

function chartPlans(input) {
  const plans = [{ id: "original", name: "原计划", schedule: input.original, color: "#64748b" }];
  const add = (id, name, schedule, color) => {
    if (schedule && schedule.length) plans.push({ id, name, schedule, color });
  };
  add("extra-shorten", input.combo ? "优先还商贷" : "提前还款缩短年限", input.shortened, "#dc2626");
  add("extra-reduce", input.combo ? "优先还商贷减少月供" : "提前还款减少月供", input.reduced, "#2563eb");
  add("fund-first", "优先还公积金", input.fundFirst && input.fundFirst.计划, "#16a34a");
  add("spare-shorten", "闲钱缩短年限", input.opportunity && input.opportunity.缩短计划, "#ea580c");
  add("spare-reduce", "闲钱减少月供", input.opportunity && input.opportunity.减供计划, "#9333ea");
  add("refinance", "转贷", input.refinance && input.refinance.计划, "#0891b2");
  return plans;
}

function showPlans(principal, plans) {
  viewPlans = plans;
  if (!viewPlans.some((plan) => plan.id === activePlanId)) {
    activePlanId = viewPlans.length > 1 ? viewPlans[1].id : "original";
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
      existing.addEventListener("error", () => reject(new Error("脚本加载失败")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("脚本加载失败"));
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

function wanTick(value) {
  if (Math.abs(value) >= 10000) {
    const wan = value / 10000;
    return (Number.isInteger(wan) ? String(wan) : wan.toFixed(1)) + "万";
  }
  return value;
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
        title: { display: !compact, text: "月份" },
        ticks: {
          maxTicksLimit: compact ? 4 : 6,
          font: tickFont,
          callback: (value) => String(Math.round(value)),
        },
      },
      y: {
        beginAtZero: true,
        ticks: { callback: wanTick, font: tickFont },
      },
    },
  };
}

function applyChartFont() {
  if (typeof Chart === "undefined") return;
  Chart.defaults.font.family = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
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
    const note = "折线图需要加载 Chart.js，请检查网络后刷新。";
    chartNote.textContent = note;
    interestChartNote.textContent = note;
    return;
  }
  if (token !== chartToken) return;
  if (typeof Chart === "undefined") {
    const note = "折线图需要加载 Chart.js，请检查网络后刷新。";
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
    [row.月份, formatYuan(row.月供), formatYuan(row.本金部分), formatYuan(row.利息部分), formatYuan(row.剩余本金)]
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
  const lines = ["期数,月供,本金,利息,剩余本金"];
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
    message.textContent = "请至少勾选一种还款计划";
    return;
  }
  message.textContent = "";
  const csv = "\uFEFF" + plans.map((plan) => plan.name + "\r\n" + buildCsv(plan)).join("\r\n\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = plans.length === 1 ? "还款计划-" + plans[0].name + ".csv" : "还款计划.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function formatReportDate(date) {
  return date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日";
}

function pdfEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pdfFacts(report) {
  const method = report.repayMethod === "principal" ? "等额本金" : "等额本息";
  const paid = report.paid > 0 ? "已还 " + report.paid + " 期" : "";
  if (report.combo) {
    const item = report.combo;
    return [
      method,
      "公积金 " + formatYuan(item.fundPrincipal) + " · " + item.fundRatePercent + "% · " + item.fundYears + " 年",
      "商贷 " + formatYuan(item.commercialPrincipal) + " · " + item.commercialRatePercent + "% · " + item.commercialYears + " 年",
      paid,
    ].filter(Boolean).join("  ·  ");
  }
  return [
    method,
    formatYuan(report.principal),
    report.ratePercent + "%",
    report.years + " 年",
    paid,
  ].filter(Boolean).join("  ·  ");
}

function pdfActionLine(report) {
  const parts = [];
  const prepay = report.combo ? report.combo.prepay : (report.prepay || 0);
  if (!report.combo && prepay > 0) parts.push("提前还款 " + formatYuan(prepay));
  report.extras.forEach((item) => {
    if (prepay > 0 && item.月份 === 1 && item.金额 === prepay) return;
    parts.push("从下一期起第 " + item.月份 + " 个月，分批还 " + formatYuan(item.金额));
  });
  if (report.opportunity) {
    parts.push("手头闲钱 " + formatYuan(report.opportunity.cash) + "，存款年化 " + report.opportunity.depositRatePercent + "%");
  }
  if (report.refinance) parts.push("转贷利率 " + report.refinance.ratePercent + "%");
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
  if (!report.combo) return formatTerm(report.years * 12);
  return "公积金 " + formatTerm(report.combo.fundYears * 12) + " · 商贷 " + formatTerm(report.combo.commercialYears * 12);
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
  card.append(pdfStat("每月月供", formatYuan(report.originalPayment), "pdf-stat-lg"));
  if (report.combo) {
    const payments = pdfEl("div", "pdf-pair");
    payments.append(
      pdfStat("公积金月供", formatYuan(report.combo.fundPayment)),
      pdfStat("商贷月供", formatYuan(report.combo.commercialPayment))
    );
    card.append(payments);
    if (report.combo.priorityNote) card.append(pdfEl("p", "pdf-caption", report.combo.priorityNote));
  }
  card.append(pdfStat("总利息", formatYuan(summary.full), "pdf-stat-md"));
  if (report.paid > 0) {
    const percent = interestProgress(summary);
    const line = pdfEl("div", "pdf-remain");
    line.append(
      pdfEl("span", "", "剩余利息 " + formatYuan(summary.remaining)),
      pdfEl("span", "", "已还 " + percent + "%")
    );
    card.append(line, pdfProgress(percent));
  } else if (!report.combo) {
    card.append(pdfStat("还款期数", pdfTermText(report), "pdf-stat-gap"));
  }
  if (summary.combo) {
    const interests = pdfEl("div", "pdf-pair");
    interests.append(
      pdfStat("公积金总利息", formatYuan(summary.fundFull), "", report.paid > 0 ? "剩余 " + formatYuan(summary.fundRemaining) : ""),
      pdfStat("商贷总利息", formatYuan(summary.commercialFull), "", report.paid > 0 ? "剩余 " + formatYuan(summary.commercialRemaining) : "")
    );
    card.append(interests);
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
  section.append(pdfEl("h2", "", "方案净收益"));
  const rows = report.comparison || [];
  if (rows.length < 2) {
    section.append(pdfEl("p", "pdf-caption", "当前只有原计划。填写提前还款、分批还款、手头闲钱或转贷后，这里会比较各方案少付多少利息。"));
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
      ? row.name + " · 最优"
      : row.tone === "second"
        ? row.name + " · 次优"
        : row.name;
    section.append(pdfBar(name, row.benefit, maxAbs, colors[row.tone] || "#475569", row.tone === "best"));
  });
  section.append(pdfEl("p", "pdf-caption", "条形长度按净收益的绝对值。正数是比原计划少付的利息。"));
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
  section.append(pdfEl("h2", "", "还款走势"));
  if (typeof Chart === "undefined" || !viewPlans.length) {
    section.append(pdfEl("p", "pdf-caption", "走势图需要加载 Chart.js。方案对比见上方的净收益条形图。"));
    return section;
  }
  applyChartFont();
  const start = chartStartingBalance(report);
  const grid = pdfEl("div", "pdf-charts");
  const charts = [
    ["剩余本金", "balance"],
    ["剩余利息", "interest"],
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
  section.append(pdfEl("h2", "", "闲钱去向"));
  const rows = [
    ["缩短年限", outcome.缩短节省利息, "#b45309"],
    ["减少月供", outcome.减供节省利息, "#7c3aed"],
    ["存款月复利", outcome.存款收益, "#0f172a"],
  ];
  const maxAbs = Math.max(...rows.map((row) => Math.abs(row[1])), 1);
  rows.forEach((row) => section.append(pdfBar(row[0], row[1], maxAbs, row[2], false)));
  const prepayBest = Math.max(outcome.缩短节省利息, outcome.减供节省利息);
  const diff = roundMoney(Math.abs(prepayBest - outcome.存款收益));
  let verdict = "提前还款和存款收益相同";
  if (prepayBest > outcome.存款收益) verdict = "提前还款比存款多 " + formatYuan(diff);
  if (outcome.存款收益 > prepayBest) verdict = "存款比提前还款多 " + formatYuan(diff);
  section.append(pdfEl("p", "pdf-caption", "年化 " + item.depositRatePercent + "%，到期 " + formatYuan(outcome.到期金额) + "。" + verdict + "。"));
  return section;
}

function pdfRefinance(report) {
  const item = report.refinance;
  const outcome = item.result;
  const section = pdfEl("section", "pdf-panel");
  section.append(pdfEl("h2", "", "转贷"));
  const grid = pdfEl("div", "pdf-mini");
  [
    ["新月供", formatYuan(outcome.新月供)],
    ["扣费后净收益", formatBenefit(roundMoney(outcome.节省利息 - item.fee))],
    ["回本", formatPayback(outcome)],
  ].forEach(([label, value]) => {
    const box = pdfEl("div", "pdf-mini-item");
    box.append(pdfEl("span", "", label), pdfEl("strong", "", value));
    grid.append(box);
  });
  section.append(grid);
  section.append(pdfEl("p", "pdf-caption", outcome.组合
    ? "公积金月供不变。新商贷利率 " + item.ratePercent + "%，手续费 " + formatYuan(item.fee) + "。"
    : "期限不变。新利率 " + item.ratePercent + "%，手续费 " + formatYuan(item.fee) + "。"));
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
  titles.append(pdfEl("h1", "", "房贷还款策略报告"));
  titles.append(pdfEl("p", "pdf-kicker", pdfFacts(report)));
  const action = pdfActionLine(report);
  if (action) titles.append(pdfEl("p", "pdf-kicker", action));
  top.append(titles, pdfEl("span", "pdf-date", dateText));
  sheet.append(top, pdfSummary(report), pdfBenefit(report));
  sheet.append(await pdfCharts(report));
  const side = pdfSide(report);
  if (side) sheet.append(side);
  sheet.append(pdfEl("p", "pdf-foot", "净收益按尚未支付的利息计算。转贷已扣除手续费。曲线从下一期起，不含已还期数。"));
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
  if (!latestReport) throw new Error("请先计算后再导出");
  try {
    await Promise.all([
      loadScript(HTML2CANVAS_SRC),
      loadScript(JSPDF_SRC),
      loadScript(CHART_SRC).catch(() => {}),
    ]);
  } catch (error) {
    throw new Error("导出 PDF 需要加载 jsPDF 和 html2canvas，请检查网络后刷新。");
  }
  if (typeof html2canvas !== "function" || !window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("导出 PDF 需要加载 jsPDF 和 html2canvas，请检查网络后刷新。");
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
