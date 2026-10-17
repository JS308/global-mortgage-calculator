/**
 * 等额本息：每月还款额固定，前期利息多、后期本金多。
 * 额外还款在当月月供之外再冲抵本金，月供金额不变，贷款会提前还清。
 *
 * @param {number} principal 贷款总额（元），例如 1000000
 * @param {number} annualRate 年利率（小数），例如 3.5% 写成 0.035
 * @param {number} years 贷款年限，例如 30
 * @param {Array<{月份: number, 金额: number}>} [extraPayments] 额外还款，同一月份会合并
 * @returns {Array<{月份: number, 月供: number, 本金部分: number, 利息部分: number, 剩余本金: number}>}
 */
function calcEqualInstallment(principal, annualRate, years, extraPayments, elapsed) {
  const opened = openLoan(principal, annualRate, years, extraPayments, elapsed, "installment");
  const { months, monthlyRate, extras } = opened.loan;
  const monthlyPayment = opened.loan.monthlyPayment;

  const schedule = [];
  let balance = opened.balance;

  for (let month = opened.startMonth; month <= months && balance > 0; month++) {
    const interest = roundMoney(balance * monthlyRate);
    const regularCoversAll = roundMoney(balance + interest) <= monthlyPayment;
    let principalPart;
    let payment;

    if (month === months || regularCoversAll) {
      principalPart = balance;
      payment = roundMoney(principalPart + interest);
      balance = 0;
    } else {
      principalPart = roundMoney(monthlyPayment - interest);
      payment = monthlyPayment;
      balance = roundMoney(balance - principalPart);
      if (balance < 0) balance = 0;

      const extra = extras.get(month) || 0;
      if (extra > 0 && balance > 0) {
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
    const interest = roundMoney(balance * monthlyRate);
    const regularCoversAll = roundMoney(balance + interest) <= monthlyPayment;
    let principalPart;
    let payment;

    if (month === months || regularCoversAll) {
      principalPart = balance;
      payment = roundMoney(principalPart + interest);
      balance = 0;
    } else {
      principalPart = roundMoney(monthlyPayment - interest);
      payment = monthlyPayment;
      balance = roundMoney(balance - principalPart);
      if (balance < 0) balance = 0;

      const extra = extras.get(month) || 0;
      if (extra > 0 && balance > 0) {
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
 * 额外还款在当月月供之外再冲抵本金，每月本金不变，贷款会提前还清。
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
    throw new Error("贷款年限必须是大于 0 的整数");
  }
  return readLoanByMonths(principal, annualRate, years * 12, extraPayments);
}

function readLoanByMonths(principal, annualRate, months, extraPayments) {
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("贷款总额必须是大于 0 的数字");
  }
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error("年利率必须是大于等于 0 的数字");
  }
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("还款期数必须是大于 0 的整数");
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
    throw new Error("已还款期数必须是大于等于 0 的整数");
  }
  if (paid >= months) {
    throw new Error("已还款期数要小于贷款期数 " + months);
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
    throw new Error("额外还款必须是列表");
  }

  const grouped = new Map();
  extraPayments.forEach((item, index) => {
    const month = item && item.月份;
    const amount = item && item.金额;
    const label = "第 " + (index + 1) + " 条额外还款";
    if (!Number.isInteger(month) || month < 1 || month > months) {
      throw new Error(label + "的月份要在 1 到 " + months + " 之间");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(label + "的金额必须大于 0");
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
    throw new Error("手头闲钱必须是大于 0 的数字");
  }
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error("存款或理财年化利率必须是大于等于 0 的数字");
  }
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("存款期数必须是大于 0 的整数");
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
function calcOpportunity(principal, mortgageRate, years, cash, depositRate, method, elapsed) {
  const spare = roundMoney(cash);
  if (!Number.isFinite(spare) || spare <= 0) {
    throw new Error("手头闲钱必须是大于 0 的数字");
  }
  const extra = [{ 月份: 1, 金额: spare }];
  const calc = amortize(method);
  const original = calc.base(principal, mortgageRate, years, null, elapsed);
  const shortened = calc.base(principal, mortgageRate, years, extra, elapsed);
  const reduced = calc.reduce(principal, mortgageRate, years, extra, elapsed);
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
function calcRefinance(principal, oldRate, years, newRate, fee, method, elapsed) {
  if (!Number.isFinite(newRate) || newRate < 0) {
    throw new Error("新贷款年利率必须是大于等于 0 的数字");
  }
  const cost = roundMoney(fee || 0);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("转贷手续费必须是大于等于 0 的数字");
  }
  const paid = normalizeElapsed(elapsed, years * 12);
  const base = amortize(method).base;
  const original = base(principal, oldRate, years, null, paid);
  const balance = paid === 0 ? roundMoney(principal) : balanceAfterSkip(principal, readLoan(principal, oldRate, years, null), paid, method);
  const refinanced = paid === 0
    ? base(principal, newRate, years)
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

/**
 * 组合贷款转贷：公积金保持原利率和原年限，只把商贷换成新利率，商贷年限不变。
 * 新月供是公积金月供加商贷新月供。手续费不计入本金。
 */
function calcComboRefinance(fundPrincipal, fundRate, fundYears, commercialPrincipal, commercialRate, commercialYears, newRate, fee, method, elapsed) {
  if (!Number.isFinite(newRate) || newRate < 0) {
    throw new Error("新贷款年利率必须是大于等于 0 的数字");
  }
  const cost = roundMoney(fee || 0);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("转贷手续费必须是大于等于 0 的数字");
  }
  const paid = normalizeElapsed(elapsed, Math.max(fundYears, commercialYears) * 12);
  const commercialMonths = commercialYears * 12;
  if (paid >= commercialMonths) {
    throw new Error("商贷已还清，不能再转贷");
  }
  const base = amortize(method).base;
  const fundMonths = fundYears * 12;
  const fund = paid >= fundMonths ? [] : base(fundPrincipal, fundRate, fundYears, null, paid);
  const commercial = base(commercialPrincipal, commercialRate, commercialYears, null, paid);
  const commercialBalance = paid === 0
    ? roundMoney(commercialPrincipal)
    : balanceAfterSkip(commercialPrincipal, readLoan(commercialPrincipal, commercialRate, commercialYears, null), paid, method);
  const refinanced = paid === 0
    ? base(commercialPrincipal, newRate, commercialYears)
    : calcFresh(method, commercialBalance, newRate, commercialMonths - paid);
  const oldInterest = roundMoney(
    fund.reduce((sum, row) => sum + row.利息部分, 0) + commercial.reduce((sum, row) => sum + row.利息部分, 0)
  );
  const newInterest = roundMoney(
    fund.reduce((sum, row) => sum + row.利息部分, 0) + refinanced.reduce((sum, row) => sum + row.利息部分, 0)
  );
  const saved = roundMoney(oldInterest - newInterest);
  let payback = null;
  if (cost <= 0) {
    payback = 0;
  } else {
    let cumulative = 0;
    for (let i = 0; i < commercial.length; i++) {
      cumulative = roundMoney(cumulative + commercial[i].利息部分 - refinanced[i].利息部分);
      if (cumulative >= cost) {
        payback = i + 1;
        break;
      }
    }
    if (payback == null && saved >= cost) payback = commercial.length;
  }
  return {
    新月供: roundMoney((fund[0] ? fund[0].月供 : 0) + refinanced[0].月供),
    商贷新月供: refinanced[0].月供,
    公积金月供: fund[0] ? fund[0].月供 : 0,
    新总利息: newInterest,
    节省利息: saved,
    回本月数: payback,
    手续费: cost,
    期数: commercial.length,
    组合: true,
    计划: mergeSchedules([fund, refinanced]),
  };
}

/**
 * 组合贷款：公积金和商贷分开做等额本息，年限各自填写，月供相加。
 * 提前还款默认先冲商贷，商贷余额不够时再冲公积金。
 * 额外节省利息 = 先还公积金的总利息 - 先还商贷的总利息。
 */
function calcComboLoan(input) {
  const fundPrincipal = roundMoney(input.fundPrincipal);
  const commercialPrincipal = roundMoney(input.commercialPrincipal);
  const fundRate = input.fundRate;
  const commercialRate = input.commercialRate;
  const fundYears = input.fundYears;
  const commercialYears = input.commercialYears;
  const extras = input.extraPayments || [];
  const method = input.method === "principal" ? "principal" : "installment";
  const elapsed = input.elapsed || 0;
  if (!Number.isFinite(fundPrincipal) || fundPrincipal <= 0) {
    throw new Error("公积金贷款金额必须是大于 0 的数字");
  }
  if (!Number.isFinite(commercialPrincipal) || commercialPrincipal <= 0) {
    throw new Error("商贷金额必须是大于 0 的数字");
  }
  if (!Number.isFinite(fundRate) || fundRate < 0) {
    throw new Error("公积金利率必须是大于等于 0 的数字");
  }
  if (!Number.isFinite(commercialRate) || commercialRate < 0) {
    throw new Error("商贷利率必须是大于等于 0 的数字");
  }

  const original = runComboSchedule(fundPrincipal, fundRate, fundYears, commercialPrincipal, commercialRate, commercialYears, [], "commercial", "shorten", method, elapsed);
  const originalInterest = roundMoney(original.schedule.reduce((sum, row) => sum + row.利息部分, 0));
  const hasExtra = extras.length > 0;
  const runWith = (priority, mode) => runComboSchedule(
    fundPrincipal, fundRate, fundYears, commercialPrincipal, commercialRate, commercialYears, extras, priority, mode, method, elapsed
  );
  const commercialFirst = hasExtra ? packComboRun(runWith("commercial", "shorten"), originalInterest, extras) : null;
  const fundFirst = hasExtra ? packComboRun(runWith("fund", "shorten"), originalInterest, extras) : null;
  const commercialReduced = hasExtra ? packComboRun(runWith("commercial", "reduce"), originalInterest, extras) : null;

  return {
    公积金月供: original.fundNextPayment,
    商贷月供: original.commercialNextPayment,
    公积金月数: original.fundMonths,
    商贷月数: original.commercialMonths,
    总月供: original.schedule[0].月供,
    总利息: originalInterest,
    公积金总利息: original.fundInterest,
    商贷总利息: original.commercialInterest,
    原期数: original.schedule.length,
    原计划: original.schedule,
    优先商贷: commercialFirst,
    优先公积金: fundFirst,
    优先商贷减少月供: commercialReduced,
    额外节省利息: commercialFirst ? roundMoney(fundFirst.总利息 - commercialFirst.总利息) : 0,
  };
}

function packComboRun(run, originalInterest, extras) {
  const interest = roundMoney(run.schedule.reduce((sum, row) => sum + row.利息部分, 0));
  const lastExtraMonth = extras.reduce((max, item) => Math.max(max, item.月份), 0);
  const upcoming = run.schedule.find((row) => row.月份 > lastExtraMonth);
  return {
    计划: run.schedule,
    总利息: interest,
    节省利息: roundMoney(originalInterest - interest),
    商贷冲抵: run.commercialExtra,
    公积金冲抵: run.fundExtra,
    还清月份: run.schedule.length,
    商贷还清月份: run.commercialEnd,
    公积金还清月份: run.fundEnd,
    之后月供: upcoming ? upcoming.月供 : 0,
  };
}

function openingPayment(principal, annualRate, months, method, installmentPayment) {
  if (method !== "principal") return installmentPayment;
  const principalPart = principalInstallment(principal, months);
  return roundMoney(principalPart + roundMoney(principal * annualRate / 12));
}

function runComboSchedule(fundPrincipal, fundRate, fundYears, commercialPrincipal, commercialRate, commercialYears, extraPayments, priority, mode, method, elapsed) {
  const fundLoan = readLoan(fundPrincipal, fundRate, fundYears);
  const commercialLoan = readLoan(commercialPrincipal, commercialRate, commercialYears);
  const horizon = Math.max(fundLoan.months, commercialLoan.months);
  const paid = normalizeElapsed(elapsed, horizon);
  const extras = groupExtraPayments(shiftExtras(extraPayments, paid), horizon);
  const usePrincipal = method === "principal";
  const fundScheduled = usePrincipal ? fundLoan.monthlyPrincipal : fundLoan.monthlyPayment;
  const commercialScheduled = usePrincipal ? commercialLoan.monthlyPrincipal : commercialLoan.monthlyPayment;
  let fundPayment = fundScheduled;
  let commercialPayment = commercialScheduled;
  let fundBalance = roundMoney(fundPrincipal);
  let commercialBalance = roundMoney(commercialPrincipal);
  for (let month = 1; month <= paid; month++) {
    if (fundBalance > 0) {
      fundBalance = paySlice(fundBalance, fundLoan.monthlyRate, fundScheduled, month >= fundLoan.months, method).balance;
    }
    if (commercialBalance > 0) {
      commercialBalance = paySlice(commercialBalance, commercialLoan.monthlyRate, commercialScheduled, month >= commercialLoan.months, method).balance;
    }
  }
  let fundExtra = 0;
  let commercialExtra = 0;
  let fundEnd = null;
  let commercialEnd = null;
  let fundNextPayment = 0;
  let commercialNextPayment = 0;
  let fundInterest = 0;
  let commercialInterest = 0;
  let seenForward = false;
  const schedule = [];

  for (let month = paid + 1; month <= horizon && (fundBalance > 0 || commercialBalance > 0); month++) {
    const fund = paySlice(fundBalance, fundLoan.monthlyRate, fundPayment, month >= fundLoan.months, method);
    const commercial = paySlice(commercialBalance, commercialLoan.monthlyRate, commercialPayment, month >= commercialLoan.months, method);
    let extra = extras.get(month) || 0;
    const order = priority === "fund" ? ["fund", "commercial"] : ["commercial", "fund"];
    order.forEach((key) => {
      const part = key === "fund" ? fund : commercial;
      const used = applyExtra(part, extra);
      extra = roundMoney(extra - used);
      if (key === "fund") fundExtra = roundMoney(fundExtra + used);
      else commercialExtra = roundMoney(commercialExtra + used);
      if (mode === "reduce" && used > 0 && part.balance > 0) {
        const ownMonths = key === "fund" ? fundLoan.months : commercialLoan.months;
        const remaining = ownMonths - month;
        if (remaining > 0) {
          const rate = key === "fund" ? fundLoan.monthlyRate : commercialLoan.monthlyRate;
          const nextPayment = usePrincipal
            ? principalInstallment(part.balance, remaining)
            : calcMonthlyPayment(part.balance, rate, remaining);
          if (key === "fund") fundPayment = nextPayment;
          else commercialPayment = nextPayment;
        }
      }
    });
    fundBalance = fund.balance;
    commercialBalance = commercial.balance;
    if (!seenForward) {
      fundNextPayment = fund.payment;
      commercialNextPayment = commercial.payment;
      seenForward = true;
    }
    fundInterest = roundMoney(fundInterest + fund.interest);
    commercialInterest = roundMoney(commercialInterest + commercial.interest);
    if (fundBalance === 0 && fundEnd == null) fundEnd = month;
    if (commercialBalance === 0 && commercialEnd == null) commercialEnd = month;
    schedule.push({
      月份: month - paid,
      月供: roundMoney(fund.payment + commercial.payment),
      本金部分: roundMoney(fund.principal + commercial.principal),
      利息部分: roundMoney(fund.interest + commercial.interest),
      剩余本金: roundMoney(fundBalance + commercialBalance),
    });
  }

  return {
    schedule,
    fundPayment: fundLoan.monthlyPayment,
    commercialPayment: commercialLoan.monthlyPayment,
    fundNextPayment,
    commercialNextPayment,
    fundInterest,
    commercialInterest,
    fundMonths: fundLoan.months,
    commercialMonths: commercialLoan.months,
    fundExtra,
    commercialExtra,
    fundEnd,
    commercialEnd,
  };
}

function paySlice(balance, monthlyRate, scheduled, forcePayoff, method) {
  if (balance <= 0) {
    return { payment: 0, principal: 0, interest: 0, balance: 0 };
  }
  const interest = roundMoney(balance * monthlyRate);
  if (method === "principal") {
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
  const covers = roundMoney(balance + interest) <= scheduled;
  if (forcePayoff || covers) {
    return {
      payment: roundMoney(balance + interest),
      principal: balance,
      interest,
      balance: 0,
    };
  }
  const principalPart = roundMoney(scheduled - interest);
  let next = roundMoney(balance - principalPart);
  if (next < 0) next = 0;
  return { payment: scheduled, principal: principalPart, interest, balance: next };
}

function applyExtra(part, extra) {
  if (extra <= 0 || part.balance <= 0) return 0;
  const applied = roundMoney(Math.min(extra, part.balance));
  part.principal = roundMoney(part.principal + applied);
  part.payment = roundMoney(part.payment + applied);
  part.balance = roundMoney(part.balance - applied);
  if (part.balance < 0) part.balance = 0;
  return applied;
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
    calcComboRefinance,
    calcComboLoan,
  };

  // 示例：100 万、年利率 3.5%、30 年
  const example = calcEqualInstallment(1_000_000, 0.035, 30);
  const first = example[0];
  const last = example[example.length - 1];
  const totalInterest = roundMoney(
    example.reduce((sum, row) => sum + row.利息部分, 0)
  );

  console.log("期数:", example.length);
  console.log("首月:", first);
  console.log("末月:", last);
  console.log("利息合计:", totalInterest);
}
