const difficulties = [
  { key: "mcEasy", label: "선택형(쉬움)", defaultWeight: 15.1 },
  { key: "mcMedium", label: "선택형(보통)", defaultWeight: 23.6 },
  { key: "mcHard", label: "선택형(어려움)", defaultWeight: 11.3 },
  { key: "saEasy", label: "서술형(쉬움)", defaultWeight: 11 },
  { key: "saMedium", label: "서술형(보통)", defaultWeight: 29 },
  { key: "saHard", label: "서술형(어려움)", defaultWeight: 10 },
];

const groups = ["A", "B", "C", "D", "E"];
const defaultTargets = { A: 84, B: 68, C: 51, D: 35, E: 19 };
const stepValues = Array.from({ length: 21 }, (_, index) => index * 5);
const maxTeacherSpread = 10;
const difficultyOrderSets = [
  [0, 1, 2],
  [3, 4, 5],
];
const typeOrderPairs = [
  [0, 3],
  [1, 4],
  [2, 5],
];

const teacherCountEl = document.querySelector("#teacherCount");
const toleranceEl = document.querySelector("#tolerance");
const weightInputsEl = document.querySelector("#weightInputs");
const targetInputsEl = document.querySelector("#targetInputs");
const calculateBtn = document.querySelector("#calculateBtn");
const normalizeWeightsBtn = document.querySelector("#normalizeWeights");
const copyExcelBtn = document.querySelector("#copyExcelBtn");
const statusPill = document.querySelector("#statusPill");
const scoreStrip = document.querySelector("#scoreStrip");
const resultWrap = document.querySelector("#resultWrap");
let latestExcelText = "";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function roundToFive(value) {
  return Math.round(value / 5) * 5;
}

function formatOne(value) {
  return roundToOne(value).toFixed(1);
}

function numericValue(selector, fallback = 0) {
  const value = Number(document.querySelector(selector)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function renderWeights() {
  weightInputsEl.innerHTML = difficulties
    .map(
      (difficulty) => `
        <label>
          <span>${difficulty.label}</span>
          <input type="number" min="0" max="100" step="0.1" value="${difficulty.defaultWeight}" data-weight="${difficulty.key}" />
        </label>
      `,
    )
    .join("");
}

function renderTargets() {
  targetInputsEl.innerHTML = groups
    .map(
      (group) => `
        <label>
          <span>${group}그룹</span>
          <input type="number" min="0" max="100" step="0.1" value="${defaultTargets[group]}" data-target="${group}" />
        </label>
      `,
    )
    .join("");
}

function readInputs() {
  const teacherCount = Number(teacherCountEl.value);
  const weights = difficulties.map((difficulty) => numericValue(`[data-weight="${difficulty.key}"]`));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const targets = Object.fromEntries(groups.map((group) => [group, numericValue(`[data-target="${group}"]`)]));

  return {
    teacherCount,
    weights,
    weightTotal,
    targets,
    tolerance: Number(toleranceEl.value),
  };
}

function validateInputs(inputs) {
  if (inputs.weightTotal <= 0) {
    return "난이도별 배점 합이 0보다 커야 합니다.";
  }
  if (Math.abs(inputs.weightTotal - 100) > 0.05) {
    return `난이도별 배점 합이 ${formatOne(inputs.weightTotal)}점입니다. 100점 보정 후 다시 계산해 주세요.`;
  }
  for (const group of groups) {
    if (inputs.targets[group] < 0 || inputs.targets[group] > 100) {
      return `${group}그룹 희망 점수는 0~100 사이여야 합니다.`;
    }
  }
  return "";
}

function weightedScore(assignments, weights) {
  const score = Object.fromEntries(groups.map((group) => [group, 0]));
  const teacherCount = assignments.length;

  assignments.forEach((teacherRows) => {
    teacherRows.forEach((vector, difficultyIndex) => {
      groups.forEach((group) => {
        score[group] += weights[difficultyIndex] * vector[group];
      });
    });
  });

  groups.forEach((group) => {
    score[group] = roundToOne(score[group] / teacherCount / 100);
  });
  return score;
}

function objective(score, targets) {
  return groups.reduce((sum, group) => {
    const diff = score[group] - targets[group];
    return sum + diff * diff;
  }, 0);
}

function difficultyGroupSpread(assignments, difficultyIndex, group) {
  const values = assignments.map((row) => row[difficultyIndex][group]);
  return Math.max(...values) - Math.min(...values);
}

function normalizeVector(vector) {
  const normalized = {};
  let ceiling = 100;
  groups.forEach((group) => {
    normalized[group] = clamp(roundToFive(Math.min(vector[group], ceiling)));
    ceiling = normalized[group];
  });
  return normalized;
}

function orderedDifficultyValue(target, level) {
  const center = clamp(roundToFive(target), 5, 95);
  if (level === "easy") return clamp(center + 5);
  if (level === "hard") return clamp(center - 5);
  return center;
}

function makeOrderedDifficultyVectors(targets) {
  return [
    normalizeVector(Object.fromEntries(groups.map((group) => [group, orderedDifficultyValue(targets[group], "easy")]))),
    normalizeVector(Object.fromEntries(groups.map((group) => [group, orderedDifficultyValue(targets[group], "medium")]))),
    normalizeVector(Object.fromEntries(groups.map((group) => [group, orderedDifficultyValue(targets[group], "hard")]))),
  ];
}

function makeInitialAssignments(inputs) {
  const orderedVectors = makeOrderedDifficultyVectors(inputs.targets);
  return Array.from({ length: inputs.teacherCount }, () =>
    difficulties.map((_, difficultyIndex) => {
      const vector = { ...orderedVectors[difficultyIndex % 3] };
      if (difficultyIndex >= 3) {
        groups.forEach((group) => {
          vector[group] = clamp(vector[group] - 5);
        });
      }
      return normalizeVector(vector);
    }),
  );
}

function respectsRowOrder(vector) {
  return groups.every((group, index) => index === 0 || vector[groups[index - 1]] >= vector[group]);
}

function respectsDifficultyOrder(assignments, teacherIndex) {
  return difficultyOrderSets.every(([easyIndex, mediumIndex, hardIndex]) =>
    groups.every((group) => {
      const easy = assignments[teacherIndex][easyIndex][group];
      const medium = assignments[teacherIndex][mediumIndex][group];
      const hard = assignments[teacherIndex][hardIndex][group];
      return easy >= medium + 5 && medium >= hard + 5;
    }),
  );
}

function respectsTypeOrder(assignments, teacherIndex) {
  return typeOrderPairs.every(([mcIndex, writtenIndex]) =>
    groups.every((group) => assignments[teacherIndex][mcIndex][group] >= assignments[teacherIndex][writtenIndex][group] + 5),
  );
}

function improveOneCell(current, inputs, teacherIndex, difficultyIndex, group) {
  let bestValue = current[teacherIndex][difficultyIndex][group];
  let bestScore = weightedScore(current, inputs.weights);
  let bestLoss = objective(bestScore, inputs.targets);

  for (const candidate of stepValues) {
    if (candidate === bestValue) continue;
    const trial = current.map((row) => [...row]);
    trial[teacherIndex] = trial[teacherIndex].map((vector) => ({ ...vector }));
    trial[teacherIndex][difficultyIndex][group] = candidate;
    if (!respectsRowOrder(trial[teacherIndex][difficultyIndex])) continue;
    if (!respectsDifficultyOrder(trial, teacherIndex)) continue;
    if (!respectsTypeOrder(trial, teacherIndex)) continue;
    if (difficultyGroupSpread(trial, difficultyIndex, group) > maxTeacherSpread) continue;
    const score = weightedScore(trial, inputs.weights);
    const loss = objective(score, inputs.targets);
    const movementPenalty = Math.abs(candidate - bestValue) * 0.0001;

    if (loss + movementPenalty < bestLoss) {
      bestValue = candidate;
      bestScore = score;
      bestLoss = loss;
    }
  }

  return { bestValue, bestScore, bestLoss };
}

function optimize(inputs) {
  const highVectors = makeOrderedDifficultyVectors({ A: 90, B: 75, C: 60, D: 45, E: 30 });
  const midVectors = makeOrderedDifficultyVectors({ A: 85, B: 70, C: 55, D: 40, E: 25 });
  const lowVectors = makeOrderedDifficultyVectors({ A: 80, B: 65, C: 50, D: 35, E: 20 });
  const vectorFromSet = (vectors, index) => {
    const vector = { ...vectors[index % 3] };
    if (index >= 3) {
      groups.forEach((group) => {
        vector[group] = clamp(vector[group] - 5);
      });
    }
    return normalizeVector(vector);
  };
  const seeds = [
    makeInitialAssignments(inputs),
    Array.from({ length: inputs.teacherCount }, () => difficulties.map((_, index) => vectorFromSet(highVectors, index))),
    Array.from({ length: inputs.teacherCount }, () => difficulties.map((_, index) => vectorFromSet(midVectors, index))),
    Array.from({ length: inputs.teacherCount }, () => difficulties.map((_, index) => vectorFromSet(lowVectors, index))),
  ];

  let globalBest = null;

  seeds.forEach((seed) => {
    let current = seed.map((row) => row.map((vector) => ({ ...vector })));
    let currentScore = weightedScore(current, inputs.weights);
    let currentLoss = objective(currentScore, inputs.targets);
    let improved = true;
    let guard = 0;

    while (improved && guard < 60) {
      improved = false;
      guard += 1;

      for (let teacherIndex = 0; teacherIndex < inputs.teacherCount; teacherIndex += 1) {
        for (let difficultyIndex = 0; difficultyIndex < difficulties.length; difficultyIndex += 1) {
          for (const group of groups) {
            const result = improveOneCell(current, inputs, teacherIndex, difficultyIndex, group);
            if (result.bestLoss < currentLoss) {
              current[teacherIndex][difficultyIndex][group] = result.bestValue;
              currentScore = result.bestScore;
              currentLoss = result.bestLoss;
              improved = true;
            }
          }
        }
      }
    }

    if (!globalBest || currentLoss < globalBest.loss) {
      globalBest = {
        assignments: current,
        score: currentScore,
        loss: currentLoss,
      };
    }
  });

  const maxError = Math.max(...groups.map((group) => Math.abs(globalBest.score[group] - inputs.targets[group])));
  return {
    assignments: globalBest.assignments,
    score: globalBest.score,
    exact: maxError === 0,
    withinTolerance: maxError <= inputs.tolerance,
    maxError: roundToOne(maxError),
  };
}

function renderScoreStrip(result, targets) {
  scoreStrip.innerHTML = groups
    .map((group) => {
      const diff = roundToOne(result.score[group] - targets[group]);
      const sign = diff > 0 ? "+" : "";
      return `
        <div class="score-card">
          <span>${group}그룹</span>
          <strong>${formatOne(result.score[group])}</strong>
          <small>목표 ${formatOne(targets[group])} · ${sign}${formatOne(diff)}</small>
        </div>
      `;
    })
    .join("");
}

function renderResultTable(result) {
  const blocks = result.assignments
    .map((row, teacherIndex) => {
      const rows = row
        .map((vector, difficultyIndex) => {
          return `
            <tr>
              <th>${difficulties[difficultyIndex].label}</th>
              ${groups.map((group) => `<td>${vector[group]}</td>`).join("")}
            </tr>
          `;
        })
        .join("");

      return `
        <div class="teacher-score-block">
          <div class="round-label">1라운드&nbsp;&nbsp;교사${teacherIndex + 1}</div>
          <table class="score-matrix">
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    })
    .join("");

  resultWrap.innerHTML = `<div class="result-blocks">${blocks}</div>`;
}

function buildExcelText(result) {
  return result.assignments
    .map((row, teacherIndex) => {
      const rows = row.map((vector, difficultyIndex) => {
        const roundLabel = difficultyIndex === 0 ? "1라운드" : "";
        const teacherLabel = difficultyIndex === 0 ? `교사${teacherIndex + 1}` : "";
        return [roundLabel, teacherLabel, difficulties[difficultyIndex].label, ...groups.map((group) => vector[group])].join("\t");
      });
      return rows.join("\n");
    })
    .join("\n\n");
}

async function copyExcelText() {
  if (!latestExcelText) return;
  try {
    await navigator.clipboard.writeText(latestExcelText);
    copyExcelBtn.textContent = "복사됨";
    setTimeout(() => {
      copyExcelBtn.textContent = "엑셀용 복사";
    }, 1200);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = latestExcelText;
    helper.className = "copy-helper";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    copyExcelBtn.textContent = "복사됨";
    setTimeout(() => {
      copyExcelBtn.textContent = "엑셀용 복사";
    }, 1200);
  }
}

function setStatus(result) {
  statusPill.classList.remove("ok", "warn", "bad");
  if (result.exact) {
    statusPill.textContent = "정확히 계산됨";
    statusPill.classList.add("ok");
  } else if (result.withinTolerance) {
    statusPill.textContent = `재계산됨 · 최대 오차 ${formatOne(result.maxError)}점`;
    statusPill.classList.add("warn");
  } else {
    statusPill.textContent = `근사값 · 최대 오차 ${formatOne(result.maxError)}점`;
    statusPill.classList.add("bad");
  }
}

function calculate() {
  const inputs = readInputs();
  const error = validateInputs(inputs);
  if (error) {
    statusPill.textContent = "입력 확인 필요";
    statusPill.className = "status-pill bad";
    scoreStrip.innerHTML = "";
    resultWrap.innerHTML = `<p class="empty-state">${error}</p>`;
    latestExcelText = "";
    copyExcelBtn.disabled = true;
    return;
  }

  const result = optimize(inputs);
  latestExcelText = buildExcelText(result);
  copyExcelBtn.disabled = false;
  setStatus(result);
  renderScoreStrip(result, inputs.targets);
  renderResultTable(result);
}

function normalizeWeights() {
  const inputs = readInputs();
  if (inputs.weightTotal <= 0) return;
  difficulties.forEach((difficulty, index) => {
    const normalized = (inputs.weights[index] / inputs.weightTotal) * 100;
    document.querySelector(`[data-weight="${difficulty.key}"]`).value = normalized.toFixed(1);
  });
}

calculateBtn.addEventListener("click", calculate);
normalizeWeightsBtn.addEventListener("click", normalizeWeights);
copyExcelBtn.addEventListener("click", copyExcelText);

renderWeights();
renderTargets();
