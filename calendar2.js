function getAvailableCalendarEvents({ start, end, categoryType, plans, events, blockPlans }) {
  // Constants
  const DAYTYPE = { SUN: 0, MON: 1, TUE: 2, WED: 3, THUR: 4, FRI: 5, SAT: 6 };
  const DEF_DAYTYPE_VALIDDAYS = [1, 2, 3, 4, 5]; // Monday to Friday
  const SECOND_MS = 1000;
  const MINUTE_MS = SECOND_MS * 60;
  const HOUR_MS = MINUTE_MS * 60;

  // Helper: Convert date to milliseconds in Eastern Time
  function dateToEastMomentMs(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    return moment.tz(date, 'America/New_York').valueOf();
  }

  // Helper: Build date with plan's time
  function buildDateFromPlan(date, planDate) {
    const planTime = moment.tz(planDate, 'America/New_York');
    return moment
      .tz('America/New_York')
      .year(date.getFullYear())
      .month(date.getMonth())
      .date(date.getDate())
      .hour(planTime.hour())
      .minute(planTime.minute())
      .second(planTime.second())
      .millisecond(planTime.millisecond())
      .toDate();
  }

  // Helper: Check if number
  function isNumber(val) {
    return typeof val === 'number' && !isNaN(val);
  }

  // Helper: Check if string
  function isString(val) {
    return typeof val === 'string';
  }

  // Helper: Check plan increment availability
  function isAvailableForPlanIncrement(startTime, endTime, eventsByDay, plan, accruedBlock) {
    if (!isNumber(plan.increment)) return true;
    const inc = plan.increment * MINUTE_MS;
    const totalDuration = eventsByDay.reduce((sum, ev) => {
      if (ev.start && ev.end) return sum + (ev.end - ev.start);
      return sum;
    }, 0);
    return totalDuration + inc + accruedBlock <= endTime - startTime;
  }

  // Helper: Check trial plan availability
  function isAvailableForPlanTrial(startTime, endTime, eventsByDay, plan, accruedBlock) {
    if (plan.capacity || plan.increment || plan.categoryType !== 'TR') return true;
    const totalDuration = eventsByDay.reduce((sum, ev) => {
      if (ev.start && ev.end) return sum + (ev.end - ev.start);
      return sum;
    }, 0);
    return totalDuration + HOUR_MS + accruedBlock <= endTime - startTime;
  }

  // Helper: Add business days
  function addBusinessDays(date, days, validDays) {
    let result = new Date(date);
    if (days <= 0) {
      while (result.getDay() === 0 || result.getDay() === 6 || !validDays.includes(result.getDay())) {
        result.setDate(result.getDate() + 1);
      }
      return result;
    }
    for (let i = 0; i < days; i++) {
      result.setDate(result.getDate() + 1);
      if (result.getDay() === 0 || result.getDay() === 6) i--;
    }
    while (!validDays.includes(result.getDay())) {
      result.setDate(result.getDate() + 1);
    }
    return result;
  }

  // Helper: Get valid days from plan
  function getValidDays(plan) {
    if (isString(plan.daysOccurringType)) {
      return plan.daysOccurringType
        .split('_')
        .map(day => DAYTYPE[day])
        .filter(day => day !== undefined);
    }
    return DEF_DAYTYPE_VALIDDAYS;
  }

  // Helper: Check if date is valid for plan
  function isValidDayForPlan(date, validDays) {
    return validDays.includes(date.getDay());
  }

  // Helper: Merge overlapping blocks
  function mergeBlocks(blocks) {
    if (!blocks.length) return [];
    blocks.sort((a, b) => a[0] - b[0]);
    const merged = [blocks[0]];
    for (const [start, end] of blocks.slice(1)) {
      const last = merged[merged.length - 1];
      if (start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  }

  // Helper: Check if date is blocked
  function isDateBlocked(date, plan, startTime, endTime, blockPlans) {
    for (const block of blockPlans) {
      if (block.division?.id !== plan.division.id || block.related?.id !== plan.id) continue;
      if (block.end <= startTime || block.start >= endTime) continue;
      const validBlockDays = isString(block.daysOccurringType)
        ? block.daysOccurringType.split('_').map(day => DAYTYPE[day]).filter(day => day !== undefined)
        : [];
      if (validBlockDays.length && !validBlockDays.includes(date.getDay())) continue;
      const blockStart = dateToEastMomentMs(buildDateFromPlan(date, block.start));
      const blockEnd = dateToEastMomentMs(buildDateFromPlan(date, block.end));
      if (blockStart <= startTime && blockEnd >= endTime) return true;
    }
    return false;
  }

  // Main logic
  const availableEvents = [];
  const startRange = Number(start);
  const endRange = Number(end);

  for (const plan of plans) {
    if (plan.categoryType !== categoryType || startRange > plan.end || endRange < plan.start) continue;

    const validDays = getValidDays(plan);
    let planDate = new Date(Math.max(startRange, plan.start));
    const lastPlanDate = new Date(Math.min(endRange, plan.end));

    // Apply scheduling days requirement
    const schedDaysReq = plan.schedDaysReq || 0;
    const today = new Date();
    const earliestDate = addBusinessDays(today, schedDaysReq, validDays);
    if (earliestDate > planDate) planDate = earliestDate;

    while (planDate <= lastPlanDate) {
      if (!isValidDayForPlan(planDate, validDays)) {
        planDate.setDate(planDate.getDate() + 1);
        continue;
      }

      const startTime = dateToEastMomentMs(buildDateFromPlan(planDate, plan.start));
      const endTime = dateToEastMomentMs(buildDateFromPlan(planDate, plan.end));
      if (moment.tz('America/New_York').valueOf() > endTime) {
        planDate.setDate(planDate.getDate() + 1);
        continue;
      }

      if (isDateBlocked(planDate, plan, startTime, endTime, blockPlans)) {
        planDate.setDate(planDate.getDate() + 1);
        continue;
      }

      // Gather events for this plan and date
      const eventsByDay = events.filter(ev => {
        if (!ev.plan || !ev.plan.id) return false;
        if (ev?.plan?.id !== plan?.id || ev.statusType === 'CANCELLED') return false;
        const evDate = new Date(ev.start);
        return (
          evDate.getFullYear() === planDate.getFullYear() &&
          evDate.getMonth() === planDate.getMonth() &&
          evDate.getDate() === planDate.getDate()
        );
      });

      // Gather and merge blocks
      const blocksByDay = blockPlans
        .filter(block => {
          if (block.division?.id !== plan.division.id || block.related?.id !== plan.id) return false;
          if (block.end <= startTime || block.start >= endTime) return false;
          const validBlockDays = isString(block.daysOccurringType)
            ? block.daysOccurringType.split('_').map(day => DAYTYPE[day]).filter(day => day !== undefined)
            : [];
          return !validBlockDays.length || validBlockDays.includes(planDate.getDay());
        })
        .map(block => [
          Math.max(dateToEastMomentMs(buildDateFromPlan(planDate, block.start)), startTime),
          Math.min(dateToEastMomentMs(buildDateFromPlan(planDate, block.end)), endTime),
        ]);
      const mergedBlocks = mergeBlocks(blocksByDay);

      // Calculate accrued block time
      const accruedBlock = mergedBlocks.reduce((sum, [blockStart, blockEnd]) => sum + (blockEnd - blockStart), 0);

      // Check availability
      let available = false;
      if (plan.capacity) {
        available = plan.capacity > eventsByDay.length;
      } else if (plan.increment) {
        available = isAvailableForPlanIncrement(startTime, endTime, eventsByDay, plan, accruedBlock);
      } else if (plan.categoryType === 'TR') {
        available = isAvailableForPlanTrial(startTime, endTime, eventsByDay, plan, accruedBlock);
      }

      if (available) {
        availableEvents.push({
          date: new Date(planDate),
          start: startTime,
          end: endTime,
          plan,
          events: eventsByDay,
          available: true,
        });
      }

      planDate.setDate(planDate.getDate() + 1);
    }
  }

  return availableEvents;
}

function escapeHtml(str) {
  if (!str) {
    return;
  }
  return str.replace(/[&<>"']/g, function(m) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m];
  });
}

function syntaxHighlight(json) {
  if (!json) {
    return;
  }
  json = escapeHtml(json);
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|\b\d+\.?\d*\b)/g, function (match) {
    let cls = 'json-value';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    } else if (/[\d.]+/.test(match)) {
      cls = 'json-number';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

function convertTimestamps(obj, locale = 'en-US', options = {}) {
  const dateOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
    ...options
  };

  function processValue(value) {
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(processValue);
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => {
          if (['start', 'end'].includes(k) && typeof v === 'number') {
            return [k, new Date(v).toLocaleString(locale, dateOptions)];
          }
          return [k, processValue(v)];
        })
      );
    }
    return value;
  }

  return processValue(obj);
}

function fetchJudges2() {
  _fetchJudges2();
}

async function _fetchJudges2() {
  loading();
  try {
    let proxy = "http://localhost:8889/proxy/";
    await fetch(`${proxy}schedulingDivisions`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    .then(response => {
      return response.json();
    })
    .then(data => {
      printResult(data);
      createJudgesList(data);
    })
    .catch(error => console.error('FETCH Error:', error));
  } catch (error) {
      console.error('TRY Error:', error);
  }
}

function printResult(result) {
  document.getElementById("results").innerHTML = '<pre>' + syntaxHighlight(JSON.stringify(convertTimestamps(result), null, 2)) + '</pre>';
}

function loading() {
  document.getElementById("results").innerHTML = "<div class=\"loading-dots\"><span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span></div>";
}

function clear() {
  document.getElementById("results").innerHTML = "";
}

function createJudgesList(data) {
  let selectHTML = '<select id="judge_id">';
  data.forEach(item => {
    selectHTML += `<option value="${item.id}">${item.label}</option>`;
  });
  selectHTML += '</select>';
  document.getElementById("judges").innerHTML = selectHTML;
}

async function getData(url, params) {
  loading();
  const  proxy = "http://localhost:8889/proxy/";
  const response = await fetch(`${proxy}${url}`, {
    mode: 'cors',
    method: 'POST',
    "headers": {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    clear();
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    clear();
    throw new Error(`Error: ${data.error}`);
  }
  return data;
}

let params = {
  start: Date.now(),
  end: Date.now() + 30 * 24 * 60 * 60 * 1000,
  categoryType: "MC",
  plans: plansJson,
  events: rangeJson,
  blockPlans: blockJson
};

const eventsUrl = "events/range";
const plansUrl = "plans";

async function click() {
  loading();
  params.categoryType = document.getElementById("categoryType").value;

  const id = document.getElementById("judge_id")?.value || 24306;
  
  if (params.categoryType === 'MC') {
    Object.assign(params, {
      events: rangeJson,
      plans: plansJson,
      blockPlans: blockJson
    });
  } else {
    Object.assign(params, {
      categoryType: "SS",
      events: rangeSSJson,
      plans: planSSJson,
      blockPlans: blockSSJson
    });
  }

  let request ={
    categoryType: params.categoryType,
    statusType: "AVAILABLE",
    division: {
      id: id
    },
    start: Date.now(),
    end: Date.now() + 30 * 24 * 60 * 60 * 1000
  }


  const promisesTasks = [
    { name: "plans", "promise": getData(plansUrl, request) },
    { name: "blocks", "promise": getData(plansUrl, Object.assign(request, { statusType: "UNAVAILABLE", categoryType: "B" })) },
    { name: "events", "promise": getData(eventsUrl, {
      start: Date.now() + 24 * 60 * 60 * 1000,
      end: Date.now() + 30 * 24 * 60 * 60 * 1000,
      division: {
        id: id
      }
    }) }
  ];

  const promises = promisesTasks.map(task => task.promise);
  let mappedResults = [];
  try {
    const results = await Promise.all(promises);
    mappedResults = promisesTasks.map((task, index) => ({
      name: task.name,
      result: results[index],
    }));
  } catch (error) {
    console.error("Error:", error.message);
    return;
  }
  console.log("mappedResults", mappedResults);
  mappedResults.forEach((task) => {
    if (task.name === "plans") {
      params.plans = task.result;
    } else if (task.name === "blocks") {
      params.blockPlans = task.result;
    } else if (task.name === "events") {
      params.events = task.result;
    }
  });

  let result = getAvailableCalendarEvents(params);
  console.log(result);
  printResult(result);
}
