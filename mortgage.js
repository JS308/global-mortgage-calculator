/**
 * 等额本息：每月还款额固定，前期利息多、后期本金多。
 * 分批还款在当月月供之外再冲抵本金，月供金额不变，贷款会提前还清。
 *
 * @param {number} principal 贷款总额（元），例如 1000000
 * @param {number} annualRate 年利率（小数），例如 3.5% 写成 0.035
 * @param {number} years 贷款年限，例如 30
 * @param {Array<{月份: number, 金额: number}>} [extraPayments] 分批还款，同一月份会合并
 * @returns {Array<{月份: number, 月供: number, 本金部分: number, 利息部分: number, 剩余本金: number}>}
 */
function calcEqualInstallment(principal, annualRate, years, extraPayments, elapsed) {
  const opened = openLoan(principal, annualRate, years, extraPayments, elapsed, "installment");
  const { months, monthlyRate, extras } = opened.loan;
  const monthlyPayment = opened.loan.monthlyPayment;

  const schedule = [];
  let balance = opened.balance;

  for (let month = opened.startMonth; month <= months && balance > 0; month++) {
    const step = amortizeInstallment(balance, monthlyRate, monthlyPayment, month === months);
    let principalPart = step.principal;
    let payment = step.payment;
    const interest = step.interest;
    balance = step.balance;

    if (balance > 0) {
      const extra = extras.get(month) || 0;
      if (extra > 0) {
        const applied = roundMoney(Math.min(extra, balance));
        principalPart = roundMoney(principalPart + applied);
        payment = roundMoney(payment + applied);
        balance = roundMoney(balance - applied);
        if (balance < 0) balance = 0;
      }
    }

    schedule.push({
      月份: month - opened.paid,
      月供: payment,
      本金部分: principalPart,
      利息部分: interest,
      剩余本金: balance,
    });
  }

  return schedule;
}

/**
 * 策略 B：年限不变，减少月供。
 * 提前还款先冲抵本金，再按剩余本金和剩余期数重算之后的月供。
 */
function calcReducedPayment(principal, annualRate, years, extraPayments, elapsed) {
  const opened = openLoan(principal, annualRate, years, extraPayments, elapsed, "installment");
  const { months, monthlyRate, extras } = opened.loan;
  let monthlyPayment = opened.loan.monthlyPayment;

  const schedule = [];
  let balance = opened.balance;

  for (let month = opened.startMonth; month <= months && balance > 0; month++) {
    const step = amortizeInstallment(balance, monthlyRate, monthlyPayment, month === months);
    let principalPart = step.principal;
    let payment = step.payment;
    const interest = step.interest;
    balance = step.balance;

    if (balance > 0) {
      const extra = extras.get(month) || 0;
      if (extra > 0) {
        const applied = roundMoney(Math.min(extra, balance));
        principalPart = roundMoney(principalPart + applied);
        payment = roundMoney(payment + applied);
        balance = roundMoney(balance - applied);
        if (balance < 0) balance = 0;
        if (balance > 0) {
          monthlyPayment = calcMonthlyPayment(balance, monthlyRate, months - month);
        }
      }
    }

    schedule.push({
      月份: month - opened.paid,
      月供: payment,
      本金部分: principalPart,
      利息部分: interest,
      剩余本金: balance,
    });
  }

  return schedule;
}

/**
 * 等额本金：每月偿还的本金固定，利息按剩余本金计算，月供逐月下降。
 * 分批还款在当月月供之外再冲抵本金，每月本金不变，贷款会提前还清。
 */
function calcEqualPrincipal(principal, annualRate, years, extraPayments, elapsed) {
  return runEqualPrincipal(principal, annualRate, years, extraPayments, "shorten", elapsed);
}

/**
 * 等额本金下的减少月供：提前还款先冲抵本金，再按剩余本金和剩余期数重算之后每月应还的本金。
 */
function calcEqualPrincipalReduced(principal, annualRate, years, extraPayments, elapsed) {
  return runEqualPrincipal(principal, annualRate, years, extraPayments, "reduce", elapsed);
}

function runEqualPrincipal(principal, annualRate, years, extraPayments, mode, elapsed) {
  const opened = openLoan(principal, annualRate, years, extraPayments, elapsed, "principal");
  const { months, monthlyRate, extras } = opened.loan;
  let monthlyPrincipal = opened.loan.monthlyPrincipal;

  const schedule = [];
  let balance = opened.balance;

  for (let month = opened.startMonth; month <= months && balance > 0; month++) {
    const interest = roundMoney(balance * monthlyRate);
    let principalPart = month === months || balance <= monthlyPrincipal ? balance : monthlyPrincipal;
    let payment = roundMoney(principalPart + interest);
    balance = roundMoney(balance - principalPart);
    if (balance < 0) balance = 0;

    const extra = extras.get(month) || 0;
    if (extra > 0 && balance > 0) {
      const applied = roundMoney(Math.min(extra, balance));
      principalPart = roundMoney(principalPart + applied);
      payment = roundMoney(payment + applied);
      balance = roundMoney(balance - applied);
      if (balance < 0) balance = 0;
      if (mode === "reduce" && balance > 0 && month < months) {
        monthlyPrincipal = principalInstallment(balance, months - month);
      }
    }

    schedule.push({
      月份: month - opened.paid,
      月供: payment,
      本金部分: principalPart,
      利息部分: interest,
      剩余本金: balance,
    });
  }

  return schedule;
}

function amortize(method) {
  if (method === "principal") {
    return { base: calcEqualPrincipal, reduce: calcEqualPrincipalReduced };
  }
  return { base: calcEqualInstallment, reduce: calcReducedPayment };
}

function mergeSchedules(parts) {
  const length = parts.reduce((max, schedule) => Math.max(max, schedule.length), 0);
  const schedule = [];
  for (let index = 0; index < length; index++) {
    const rows = parts.map((item) => item[index]).filter(Boolean);
    schedule.push({
      月份: index + 1,
      月供: roundMoney(rows.reduce((sum, row) => sum + row.月供, 0)),
      本金部分: roundMoney(rows.reduce((sum, row) => sum + row.本金部分, 0)),
      利息部分: roundMoney(rows.reduce((sum, row) => sum + row.利息部分, 0)),
      剩余本金: roundMoney(rows.reduce((sum, row) => sum + row.剩余本金, 0)),
    });
  }
  return schedule;
}

function readLoan(principal, annualRate, years, extraPayments) {
  if (!Number.isInteger(years) || years <= 0) {
    throw new Error("Loan term must be a whole number of years greater than 0");
  }
  return readLoanByMonths(principal, annualRate, years * 12, extraPayments);
}

function readLoanByMonths(principal, annualRate, months, extraPayments) {
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("Loan amount must be a number greater than 0");
  }
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error("Interest rate must be a number greater than or equal to 0");
  }
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("Number of payments must be a whole number greater than 0");
  }

  const monthlyRate = annualRate / 12;
  return {
    months,
    monthlyRate,
    monthlyPayment: calcMonthlyPayment(principal, monthlyRate, months),
    monthlyPrincipal: principalInstallment(principal, months),
    extras: groupExtraPayments(extraPayments, months),
  };
}

function normalizeElapsed(elapsed, months) {
  const paid = elapsed == null ? 0 : elapsed;
  if (!Number.isInteger(paid) || paid < 0) {
    throw new Error("Payments already made must be a whole number greater than or equal to 0");
  }
  if (paid >= months) {
    throw new Error("Payments already made must be less than the " + months + " payments in the loan term");
  }
  return paid;
}

function shiftExtras(extraPayments, paid) {
  if (!extraPayments || paid === 0) return extraPayments;
  return extraPayments.map((item) => ({
    月份: item.月份 + paid,
    金额: item.金额,
  }));
}

function openLoan(principal, annualRate, years, extraPayments, elapsed, method) {
  const paid = normalizeElapsed(elapsed, years * 12);
  const loan = readLoan(principal, annualRate, years, shiftExtras(extraPayments, paid));
  return {
    loan,
    paid,
    startMonth: paid + 1,
    balance: balanceAfterSkip(principal, loan, paid, method),
  };
}

function balanceAfterSkip(principal, loan, paid, method) {
  let balance = roundMoney(principal);
  const scheduled = method === "principal" ? loan.monthlyPrincipal : loan.monthlyPayment;
  for (let month = 1; month <= paid && balance > 0; month++) {
    balance = paySlice(balance, loan.monthlyRate, scheduled, month === loan.months, method).balance;
  }
  return balance;
}

function calcFresh(method, principal, annualRate, months) {
  const loan = readLoanByMonths(principal, annualRate, months, null);
  if (method === "principal") {
    const schedule = [];
    let balance = roundMoney(principal);
    const monthlyPrincipal = loan.monthlyPrincipal;
    for (let month = 1; month <= months && balance > 0; month++) {
      const interest = roundMoney(balance * loan.monthlyRate);
      const principalPart = month === months || balance <= monthlyPrincipal ? balance : monthlyPrincipal;
      const payment = roundMoney(principalPart + interest);
      balance = roundMoney(Math.max(0, balance - principalPart));
      schedule.push({
        月份: month,
        月供: payment,
        本金部分: principalPart,
        利息部分: interest,
        剩余本金: balance,
      });
    }
    return schedule;
  }
  const schedule = [];
  let balance = roundMoney(principal);
  const monthlyPayment = loan.monthlyPayment;
  for (let month = 1; month <= months && balance > 0; month++) {
    const step = paySlice(balance, loan.monthlyRate, monthlyPayment, month === months, "installment");
    balance = step.balance;
    schedule.push({
      月份: month,
      月供: step.payment,
      本金部分: step.principal,
      利息部分: step.interest,
      剩余本金: balance,
    });
  }
  return schedule;
}

function principalInstallment(principal, months) {
  const part = roundMoney(principal / months);
  return part > 0 ? part : roundMoney(principal);
}

function groupExtraPayments(extraPayments, months) {
  if (extraPayments == null) return new Map();
  if (!Array.isArray(extraPayments)) {
    throw new Error("Extra payments must be a list");
  }

  const grouped = new Map();
  extraPayments.forEach((item, index) => {
    const month = item && item.月份;
    const amount = item && item.金额;
    const label = "Extra payment " + (index + 1);
    if (!Number.isInteger(month) || month < 1 || month > months) {
      throw new Error(label + " must fall between payment 1 and " + months);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(label + " amount must be greater than 0");
    }
    grouped.set(month, roundMoney((grouped.get(month) || 0) + amount));
  });
  return grouped;
}

/** 月供 = 本金 × 月利率 × (1+月利率)^期数 / ((1+月利率)^期数 - 1) */
function calcMonthlyPayment(principal, monthlyRate, months) {
  if (monthlyRate === 0) {
    return roundMoney(principal / months);
  }
  const factor = (1 + monthlyRate) ** months;
  return roundMoney((principal * monthlyRate * factor) / (factor - 1));
}

function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}

/**
 * 存款或理财按月复利。每期利息先保留到分，再滚入本金。
 * @returns {{到期金额: number, 收益: number}}
 */
function calcDepositGrowth(amount, annualRate, months) {
  const principal = roundMoney(amount);
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("Cash on hand must be a number greater than 0");
  }
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error("Savings or investment APY must be a number greater than or equal to 0");
  }
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("Savings term must be a whole number of months greater than 0");
  }

  let balance = principal;
  const monthlyRate = annualRate / 12;
  for (let month = 1; month <= months; month++) {
    balance = roundMoney(balance + roundMoney(balance * monthlyRate));
  }
  return {
    到期金额: balance,
    收益: roundMoney(balance - principal),
  };
}

/**
 * 同一笔闲钱的三种用法。
 * 提前还款缩短年限：第 1 个月一次性冲抵本金，月供不变。
 * 提前还款减少月供：同样冲抵本金，年限不变，之后月供下降。
 * 存款月复利：不提前还，按月复利存到原贷款结束。
 */
function calcOpportunity(principal, mortgageRate, years, cash, depositRate, method, elapsed, arm) {
  const spare = roundMoney(cash);
  if (!Number.isFinite(spare) || spare <= 0) {
    throw new Error("Cash on hand must be a number greater than 0");
  }
  const extra = [{ 月份: 1, 金额: spare }];
  const original = runSchedule(method, "shorten", principal, mortgageRate, years, null, elapsed, arm);
  const shortened = runSchedule(method, "shorten", principal, mortgageRate, years, extra, elapsed, arm);
  const reduced = runSchedule(method, "reduce", principal, mortgageRate, years, extra, elapsed, arm);
  const originalInterest = roundMoney(original.reduce((sum, row) => sum + row.利息部分, 0));
  const shortenedInterest = roundMoney(shortened.reduce((sum, row) => sum + row.利息部分, 0));
  const reducedInterest = roundMoney(reduced.reduce((sum, row) => sum + row.利息部分, 0));
  const applied = roundMoney(shortened[0].本金部分 - original[0].本金部分);
  const upcoming = reduced.find((row) => row.月份 > 1);
  const reducedPayment = upcoming
    ? upcoming.月供
    : reduced[reduced.length - 1].月份 < original.length ? 0 : original[0].月供;
  const deposit = calcDepositGrowth(spare, depositRate, original.length);
  return {
    缩短节省利息: roundMoney(originalInterest - shortenedInterest),
    缩短月供: original[0].月供,
    还清月份: shortened.length,
    提前月数: original.length - shortened.length,
    减供节省利息: roundMoney(originalInterest - reducedInterest),
    减供月供: reducedPayment,
    减供期数: reduced.length,
    原期数: original.length,
    实际冲抵: applied > 0 ? applied : 0,
    存款收益: deposit.收益,
    到期金额: deposit.到期金额,
    缩短计划: shortened,
    减供计划: reduced,
  };
}

/**
 * 转贷：贷款总额和期限不变，只更换年利率。
 * 手续费一次性支付，不计入本金。
 * 回本月数是累计少付的利息第一次盖过手续费的月份；盖不过则为 null。
 */
function calcRefinance(principal, oldRate, years, newRate, fee, method, elapsed, arm) {
  if (!Number.isFinite(newRate) || newRate < 0) {
    throw new Error("Refinance rate must be a number greater than or equal to 0");
  }
  const cost = roundMoney(fee || 0);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Refinance closing costs must be a number greater than or equal to 0");
  }
  const paid = normalizeElapsed(elapsed, years * 12);
  const original = runSchedule(method, "shorten", principal, oldRate, years, null, paid, arm);
  const balance = currentBalance(principal, oldRate, years, paid, method, arm);
  const refinanced = paid === 0
    ? amortize(method).base(principal, newRate, years)
    : calcFresh(method, balance, newRate, years * 12 - paid);
  const originalInterest = roundMoney(original.reduce((sum, row) => sum + row.利息部分, 0));
  const newInterest = roundMoney(refinanced.reduce((sum, row) => sum + row.利息部分, 0));
  const saved = roundMoney(originalInterest - newInterest);
  let payback = null;
  if (cost <= 0) {
    payback = 0;
  } else {
    let cumulative = 0;
    for (let i = 0; i < original.length; i++) {
      cumulative = roundMoney(cumulative + original[i].利息部分 - refinanced[i].利息部分);
      if (cumulative >= cost) {
        payback = i + 1;
        break;
      }
    }
    if (payback == null && saved >= cost) payback = original.length;
  }
  return {
    新月供: refinanced[0].月供,
    新总利息: newInterest,
    节省利息: saved,
    回本月数: payback,
    手续费: cost,
    期数: original.length,
    组合: false,
    计划: refinanced,
  };
}

function runSchedule(method, mode, principal, annualRate, years, extraPayments, elapsed, arm) {
  if (!arm) {
    const calc = amortize(method);
    return mode === "reduce"
      ? calc.reduce(principal, annualRate, years, extraPayments, elapsed)
      : calc.base(principal, annualRate, years, extraPayments, elapsed);
  }
  return simulateArm(principal, annualRate, years, extraPayments, elapsed, method, mode, arm.fixedYears, arm.adjustedRate);
}

function currentBalance(principal, annualRate, years, elapsed, method, arm) {
  const paid = normalizeElapsed(elapsed, years * 12);
  if (paid === 0) return roundMoney(principal);
  if (!arm) return balanceAfterSkip(principal, readLoan(principal, annualRate, years, null), paid, method);
  const schedule = simulateArm(principal, annualRate, years, null, paid, method, "shorten", arm.fixedYears, arm.adjustedRate);
  if (!schedule.length) return 0;
  return roundMoney(schedule[0].剩余本金 + schedule[0].本金部分);
}

/**
 * ARM: the initial rate is used until the fixed period ends, as if it lasted the full term.
 * On the first adjusted payment, the payment is recast from the remaining balance and term.
 */
function simulateArm(principal, annualRate, years, extraPayments, elapsed, method, mode, fixedYears, adjustedRate) {
  if (!Number.isInteger(fixedYears) || fixedYears <= 0) {
    throw new Error("ARM fixed period must be a whole number of years greater than 0");
  }
  if (!Number.isFinite(adjustedRate) || adjustedRate < 0) {
    throw new Error("Adjusted rate must be a number greater than or equal to 0");
  }
  if (!Number.isInteger(years) || fixedYears >= years) {
    throw new Error("ARM fixed period must be shorter than the loan term");
  }
  const months = years * 12;
  const paid = normalizeElapsed(elapsed, months);
  const extras = readLoan(principal, annualRate, years, shiftExtras(extraPayments, paid)).extras;
  const fixedMonths = fixedYears * 12;
  let monthlyPayment = calcMonthlyPayment(principal, annualRate / 12, months);
  let monthlyPrincipal = principalInstallment(principal, months);
  let balance = roundMoney(principal);

  function rateFor(month) {
    return (month <= fixedMonths ? annualRate : adjustedRate) / 12;
  }

  function recastIfDue(month) {
    if (month !== fixedMonths + 1 || balance <= 0) return;
    const remaining = months - month + 1;
    if (method === "principal") monthlyPrincipal = principalInstallment(balance, remaining);
    else monthlyPayment = calcMonthlyPayment(balance, adjustedRate / 12, remaining);
  }

  function stepMonth(month) {
    recastIfDue(month);
    const scheduled = method === "principal" ? monthlyPrincipal : monthlyPayment;
    const step = paySlice(balance, rateFor(month), scheduled, month === months, method);
    let principalPart = step.principal;
    let payment = step.payment;
    balance = step.balance;
    const extra = month === months ? 0 : (extras.get(month) || 0);
    if (extra > 0 && balance > 0) {
      const applied = roundMoney(Math.min(extra, balance));
      principalPart = roundMoney(principalPart + applied);
      payment = roundMoney(payment + applied);
      balance = roundMoney(Math.max(0, balance - applied));
      if (mode === "reduce" && balance > 0 && month < months) {
        const remaining = months - month;
        if (method === "principal") monthlyPrincipal = principalInstallment(balance, remaining);
        else monthlyPayment = calcMonthlyPayment(balance, rateFor(month), remaining);
      }
    }
    return { payment, principal: principalPart, interest: step.interest };
  }

  for (let month = 1; month <= paid && balance > 0; month++) stepMonth(month);

  const schedule = [];
  for (let month = paid + 1; month <= months && balance > 0; month++) {
    const step = stepMonth(month);
    schedule.push({
      月份: month - paid,
      月供: step.payment,
      本金部分: step.principal,
      利息部分: step.interest,
      剩余本金: balance,
    });
  }
  return schedule;
}

/**
 * Bi-weekly plan: half of the current principal-and-interest payment, 26 times a year.
 * Each period compounds at annualRate / 26. An ARM recasts that half-payment once,
 * after exactly 26 periods for every year of the remaining fixed period.
 */
function calcBiweekly(principal, annualRate, years, elapsed, method, arm) {
  const periodsPerYear = 26;
  const months = years * 12;
  const paid = normalizeElapsed(elapsed, months);
  const balance = currentBalance(principal, annualRate, years, paid, method, arm);
  const remainingMonths = months - paid;
  const inFixedPeriod = !arm || paid < arm.fixedYears * 12;
  const activeRate = inFixedPeriod ? annualRate : arm.adjustedRate;
  const monthlyRate = activeRate / 12;
  const monthlyPayment = method === "principal"
    ? roundMoney(principalInstallment(balance, remainingMonths) + roundMoney(balance * monthlyRate))
    : calcMonthlyPayment(balance, monthlyRate, remainingMonths);
  const monthlySchedule = runSchedule(method, "shorten", principal, annualRate, years, null, paid, arm);
  const monthlyInterest = roundMoney(monthlySchedule.reduce((sum, row) => sum + row.利息部分, 0));
  const startingPayment = roundMoney(monthlyPayment / 2);
  if (startingPayment <= 0) throw new Error("Bi-weekly payment must be greater than 0");

  let bal = balance;
  let payment = startingPayment;
  let interestTotal = 0;
  let periods = 0;
  const fixedMonthsLeft = arm ? Math.max(0, arm.fixedYears * 12 - paid) : remainingMonths;
  const switchAfter = arm ? Math.round(fixedMonthsLeft * periodsPerYear / 12) : Infinity;
  const buckets = new Map();
  const maxPeriods = Math.max(Math.ceil(remainingMonths * periodsPerYear / 12) * 2, periodsPerYear);

  while (bal > 0) {
    periods += 1;
    if (periods > maxPeriods) {
      throw new Error("Bi-weekly payment does not cover the interest, so the balance never pays off");
    }
    if (arm && switchAfter < Infinity && periods === switchAfter + 1 && bal > 0) {
      const elapsedMonths = Math.min(remainingMonths - 1, Math.round(switchAfter * 12 / periodsPerYear));
      const left = Math.max(1, remainingMonths - elapsedMonths);
      const recast = method === "principal"
        ? roundMoney(principalInstallment(bal, left) + roundMoney(bal * arm.adjustedRate / 12))
        : calcMonthlyPayment(bal, arm.adjustedRate / 12, left);
      payment = roundMoney(recast / 2);
      if (payment <= 0) throw new Error("Bi-weekly payment must be greater than 0");
    }
    const annual = arm && periods > switchAfter ? arm.adjustedRate : activeRate;
    const step = amortizeInstallment(bal, annual / periodsPerYear, payment, false);
    if (step.balance >= bal) {
      throw new Error("Bi-weekly payment does not cover the interest, so the balance never pays off");
    }
    bal = step.balance;
    interestTotal = roundMoney(interestTotal + step.interest);
    const month = Math.max(1, Math.ceil(periods * 12 / periodsPerYear));
    const bucket = buckets.get(month) || { 月份: month, 月供: 0, 本金部分: 0, 利息部分: 0, 剩余本金: bal };
    bucket.月供 = roundMoney(bucket.月供 + step.payment);
    bucket.本金部分 = roundMoney(bucket.本金部分 + step.principal);
    bucket.利息部分 = roundMoney(bucket.利息部分 + step.interest);
    bucket.剩余本金 = bal;
    buckets.set(month, bucket);
  }

  if (interestTotal > roundMoney(Math.max(balance, 1) * 30)) {
    throw new Error("Bi-weekly interest is not a plausible result for this loan");
  }

  const schedule = [...buckets.values()].sort((a, b) => a.月份 - b.月份);
  return {
    biweeklyPayment: startingPayment,
    laterBiweeklyPayment: payment,
    periods,
    payoffMonths: schedule.length,
    monthlyMonths: monthlySchedule.length,
    savedInterest: roundMoney(monthlyInterest - interestTotal),
    interest: interestTotal,
    monthsSaved: monthlySchedule.length - schedule.length,
    schedule,
  };
}

/**
 * One installment period. Interest is balance times the periodic rate, rounded to cents.
 * Principal is the rest of the payment. If cent rounding would freeze or raise the balance,
 * one cent of principal is paid so the loan still amortizes.
 */
function amortizeInstallment(balance, periodicRate, scheduled, forcePayoff) {
  if (balance <= 0) {
    return { payment: 0, principal: 0, interest: 0, balance: 0 };
  }
  let interest = roundMoney(balance * periodicRate);
  const payoff = roundMoney(balance + interest);
  if (forcePayoff || payoff <= scheduled) {
    return { payment: payoff, principal: balance, interest, balance: 0 };
  }
  let principalPart = roundMoney(scheduled - interest);
  let payment = scheduled;
  if (principalPart < 0.01) {
    principalPart = Math.min(balance, 0.01);
    payment = roundMoney(interest + principalPart);
    interest = roundMoney(payment - principalPart);
  }
  return {
    payment,
    principal: principalPart,
    interest,
    balance: roundMoney(Math.max(0, balance - principalPart)),
  };
}

function paySlice(balance, monthlyRate, scheduled, forcePayoff, method) {
  if (method === "principal") {
    if (balance <= 0) {
      return { payment: 0, principal: 0, interest: 0, balance: 0 };
    }
    const interest = roundMoney(balance * monthlyRate);
    const principalPart = forcePayoff || balance <= scheduled ? balance : scheduled;
    let next = roundMoney(balance - principalPart);
    if (next < 0) next = 0;
    return {
      payment: roundMoney(principalPart + interest),
      principal: principalPart,
      interest,
      balance: next,
    };
  }
  return amortizeInstallment(balance, monthlyRate, scheduled, forcePayoff);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calcEqualInstallment,
    calcReducedPayment,
    calcEqualPrincipal,
    calcEqualPrincipalReduced,
    calcDepositGrowth,
    calcOpportunity,
    calcRefinance,
    runSchedule,
    currentBalance,
    calcBiweekly,
  };

  const example = calcEqualInstallment(500_000, 0.065, 30);
  const first = example[0];
  const last = example[example.length - 1];
  const totalInterest = roundMoney(
    example.reduce((sum, row) => sum + row.利息部分, 0)
  );

  console.log("payments:", example.length);
  console.log("first:", first);
  console.log("last:", last);
  console.log("interest:", totalInterest);
}
