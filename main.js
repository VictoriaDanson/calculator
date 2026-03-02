/*
 * 逻辑结构说明：
 * 1. UI 层：负责按钮、显示、历史列表、主题切换等 DOM 操作
 * 2. 表达式引擎：包含 token 化、中缀转后缀（RPN）、RPN 求值
 * 3. 状态管理：记录当前表达式、上一次结果、错误状态、历史记录等
 * 4. 输入处理：统一处理鼠标点击和键盘输入
 */

// ========================
// 全局状态 & DOM 引用
// ========================
const expressionDisplay = document.getElementById("expressionDisplay");
const resultDisplay = document.getElementById("resultDisplay");
const keypad = document.querySelector(".keypad");
const historyPanel = document.getElementById("historyPanel");
const historyHeader = document.getElementById("historyHeader");
const historyList = document.getElementById("historyList");
const historyEmptyText = document.getElementById("historyEmptyText");
const historyClearButton = document.getElementById("historyClearButton");
const themeToggleButton = document.getElementById("themeToggle");
const rootElement = document.documentElement;

// 当前输入的表达式字符串（内部表示，使用 sqrt，而不是 √）
let currentExpression = "";
// 上一次成功计算的数值结果（Number）
let lastResultValue = null;
// 当前是否处于“刚刚计算完”的状态（影响后续输入行为）
let justEvaluated = false;
// 当前是否存在错误（影响后续输入行为）
let hasError = false;
// 历史记录：数组，元素为 { expression: string, result: string }
let historyItems = [];
// 主题状态：'auto' | 'light' | 'dark'
let themeMode = "auto";

// ========================
// 工具函数：显示更新 & 状态重置
// ========================

/**
 * 将内部表达式（含 sqrt）格式化为展示用字符串（显示为 √）
 */
function formatExpressionForDisplay(expr) {
  if (!expr) return "";
  // 将 sqrt( 替换为 √(
  return expr.replace(/sqrt\(/g, "√(");
}

/**
 * 将结果数值格式化为字符串：
 * - 四舍五入到 6 位小数
 * - 去掉末尾多余 0 和小数点
 * - 若超出范围，则抛出溢出错误
 */
function formatResult(value) {
  const MAX_ABS_VALUE = 1e12; // 自定义显示范围限制
  if (!isFinite(value)) {
    throw new Error("错误：结果不是有限数值");
  }
  if (Math.abs(value) > MAX_ABS_VALUE) {
    throw new Error("错误：结果超出显示范围");
  }

  const factor = 1e6;
  const rounded = Math.round(value * factor) / factor;
  let str = rounded.toFixed(6);
  // 去掉末尾多余的 0 和小数点
  str = str.replace(/\.?0+$/, "");
  return str;
}

/**
 * 同步更新表达式和结果在 UI 上的显示
 */
function updateDisplays() {
  expressionDisplay.textContent = formatExpressionForDisplay(currentExpression);
  // 结果显示由计算函数或错误处理单独控制
}

/**
 * 清空所有状态（AC）
 */
function clearAll() {
  currentExpression = "";
  lastResultValue = null;
  justEvaluated = false;
  hasError = false;
  expressionDisplay.textContent = "";
  resultDisplay.textContent = "";
}

/**
 * 删除最后一个字符（DEL）
 */
function deleteLast() {
  if (!currentExpression || justEvaluated || hasError) {
    // 刚计算完或处于错误状态时，DEL 等同于清空结果
    clearAll();
    return;
  }
  currentExpression = currentExpression.slice(0, -1);
  updateDisplays();
}

/**
 * 为即将写入的输入做准备：
 * - 如果处于错误状态：清空并重新开始
 * - 如果刚完成一次计算：
 *   - 若输入的是运算符：在上次结果后继续运算
 *   - 若输入的是数字或小数点或函数：开始新的表达式
 */
function prepareForNewInput({ isOperator }) {
  if (hasError) {
    currentExpression = "";
    resultDisplay.textContent = "";
    hasError = false;
    justEvaluated = false;
    return;
  }

  if (justEvaluated) {
    if (isOperator) {
      if (lastResultValue !== null) {
        currentExpression = String(lastResultValue);
      }
    } else {
      currentExpression = "";
      resultDisplay.textContent = "";
    }
    justEvaluated = false;
  }
}

/**
 * 追加数字字符到表达式
 */
function appendDigit(digit) {
  prepareForNewInput({ isOperator: false });
  currentExpression += digit;
  updateDisplays();
}

/**
 * 追加运算符到表达式
 */
function appendOperator(op) {
  prepareForNewInput({ isOperator: true });

  if (!currentExpression) {
    // 开头只能输入 + 或 -，作为一元正负号
    if (op === "+" || op === "-") {
      currentExpression += op;
      updateDisplays();
    }
    return;
  }

  const lastChar = currentExpression[currentExpression.length - 1];
  // 若最后一个字符已经是运算符，则替换
  if ("+-*/%^".includes(lastChar)) {
    currentExpression = currentExpression.slice(0, currentExpression.length - 1) + op;
  } else {
    currentExpression += op;
  }
  updateDisplays();
}

/**
 * 追加左/右括号
 */
function appendParenthesis(paren) {
  const isOperator = false;
  prepareForNewInput({ isOperator });

  currentExpression += paren;
  updateDisplays();
}

/**
 * 追加小数点，防止当前数字中出现多个小数点
 */
function appendDecimalPoint() {
  prepareForNewInput({ isOperator: false });
  // 找到最后一段数字（包括可能的前导负号）
  const match = currentExpression.match(/(?:^|[+\-*/%^(\s])(-?\d*\.?\d*)$/);
  if (match && match[1].includes(".")) {
    // 当前数字已经有小数点，忽略
    return;
  }
  if (!currentExpression || /[+\-*/%^(\s]$/.test(currentExpression)) {
    // 表达式为空或最后是运算符/左括号，则补 0.
    currentExpression += "0.";
  } else {
    currentExpression += ".";
  }
  updateDisplays();
}

/**
 * 插入平方根：内部表示为 sqrt(
 * 用户需要自己补右括号
 */
function appendSqrt() {
  prepareForNewInput({ isOperator: false });
  // 如果前一个字符是数字或右括号，则默认插入乘号再跟 sqrt
  if (currentExpression && /[\d)]$/.test(currentExpression)) {
    currentExpression += "*";
  }
  currentExpression += "sqrt(";
  updateDisplays();
}

/**
 * 正负号切换：对当前表达式中最后一个数字部分取反
 */
function toggleSign() {
  if (!currentExpression) return;

  prepareForNewInput({ isOperator: false });

  // 匹配末尾的数字（允许小数），不包含前面的运算符
  const numberMatch = currentExpression.match(/(\d*\.?\d+)(?!.*\d)/);
  if (!numberMatch) return;

  const number = numberMatch[1];
  const index = numberMatch.index;

  if (index === null || index === undefined) return;

  const before = currentExpression.slice(0, index);
  const after = currentExpression.slice(index + number.length);

  // 判断前面是否已经有一元负号
  const charBefore = before[before.length - 1];
  const isUnaryNegative =
    charBefore === "-" &&
    (before.length === 1 || "+-*/%^(".includes(before[before.length - 2] || ""));

  if (isUnaryNegative) {
    // 已经是负数：去掉一元负号
    currentExpression = before.slice(0, before.length - 1) + number + after;
  } else {
    // 否则添加一元负号
    currentExpression = before + "-" + number + after;
  }

  updateDisplays();
}

// ========================
// 表达式解析与计算（核心逻辑）
// ========================

/**
 * 将表达式字符串分解为 token 列表
 * 支持数字、小数、sqrt 函数、运算符和括号
 */
function tokenize(expr) {
  const tokens = [];
  const pattern = /\s*([0-9]*\.?[0-9]+|sqrt|\+|\-|\*|\/|\^|%|\(|\))/g;
  let match;
  let lastIndex = 0;

  while ((match = pattern.exec(expr)) !== null) {
    if (match.index !== lastIndex) {
      // 存在无法识别的字符
      throw new Error("错误：表达式中包含非法字符");
    }
    tokens.push(match[1]);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex !== expr.length) {
    throw new Error("错误：表达式中包含非法字符");
  }

  return tokens;
}

/**
 * 中缀表达式转后缀（RPN）：
 * - 支持 + - * / % ^
 * - 支持一元负号（记作 'neg'）
 * - 支持 sqrt 函数
 */
function infixToRPN(tokens) {
  const output = [];
  const opStack = [];

  const precedence = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
    "%": 2,
    "^": 3,
    neg: 4 // 一元负号优先级最高
  };

  const rightAssociative = {
    "^": true,
    neg: true
  };

  let prevType = "start"; // 标记前一个 token 类型，用于判断一元运算符

  for (const token of tokens) {
    if (!isNaN(token)) {
      // 数字
      output.push(token);
      prevType = "number";
    } else if (token === "sqrt") {
      opStack.push({ type: "func", value: "sqrt" });
      prevType = "func";
    } else if (token === "(") {
      opStack.push({ type: "paren", value: "(" });
      prevType = "paren";
    } else if (token === ")") {
      // 依次弹出直到遇到左括号
      let foundLeftParen = false;
      while (opStack.length > 0) {
        const top = opStack.pop();
        if (top.type === "paren" && top.value === "(") {
          foundLeftParen = true;
          // 若栈顶是函数，则也输出
          if (opStack.length > 0 && opStack[opStack.length - 1].type === "func") {
            output.push(opStack.pop().value);
          }
          break;
        } else {
          output.push(top.value);
        }
      }
      if (!foundLeftParen) {
        throw new Error("错误：括号不匹配");
      }
      prevType = "paren";
    } else if ("+-*/%^".includes(token)) {
      // 判断一元负号：出现在表达式开头，或者前面是运算符/左括号/函数
      let op = token;
      if (
        token === "-" &&
        (prevType === "start" ||
          prevType === "operator" ||
          prevType === "paren" ||
          prevType === "func")
      ) {
        op = "neg";
      }

      const o1 = op;
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1];
        if (top.type !== "op" && top.type !== "func") break;

        const o2 = top.value;
        if (
          (top.type === "op" &&
            ((rightAssociative[o1] && precedence[o1] < precedence[o2]) ||
              (!rightAssociative[o1] && precedence[o1] <= precedence[o2]))) ||
          top.type === "func"
        ) {
          output.push(opStack.pop().value);
        } else {
          break;
        }
      }
      opStack.push({ type: "op", value: o1 });
      prevType = "operator";
    } else {
      throw new Error("错误：无法解析的符号");
    }
  }

  // 将栈中剩余运算符全部弹出
  while (opStack.length > 0) {
    const top = opStack.pop();
    if (top.type === "paren") {
      throw new Error("错误：括号不匹配");
    }
    output.push(top.value);
  }

  return output;
}

/**
 * 计算后缀（RPN）表达式
 */
function evaluateRPN(rpn) {
  const stack = [];

  for (const token of rpn) {
    if (!isNaN(token)) {
      stack.push(parseFloat(token));
    } else if (token === "neg") {
      if (stack.length < 1) {
        throw new Error("错误：一元运算符缺少操作数");
      }
      const a = stack.pop();
      stack.push(-a);
    } else if (token === "sqrt") {
      if (stack.length < 1) {
        throw new Error("错误：平方根运算缺少操作数");
      }
      const a = stack.pop();
      if (a < 0) {
        throw new Error("错误：不能对负数开平方");
      }
      stack.push(Math.sqrt(a));
    } else if ("+-*/%^".includes(token)) {
      if (stack.length < 2) {
        throw new Error("错误：运算符缺少操作数");
      }
      const b = stack.pop();
      const a = stack.pop();
      let res;
      switch (token) {
        case "+":
          res = a + b;
          break;
        case "-":
          res = a - b;
          break;
        case "*":
          res = a * b;
          break;
        case "/":
          if (b === 0) {
            throw new Error("错误：除数不能为 0");
          }
          res = a / b;
          break;
        case "%":
          if (b === 0) {
            throw new Error("错误：取余除数不能为 0");
          }
          res = a % b;
          break;
        case "^":
          res = Math.pow(a, b);
          break;
        default:
          throw new Error("错误：未知运算符");
      }
      stack.push(res);
    } else {
      throw new Error("错误：无效的后缀表达式");
    }
  }

  if (stack.length !== 1) {
    throw new Error("错误：表达式不完整或多余");
  }
  return stack[0];
}

/**
 * 对外暴露的表达式求值方法：
 * - 负责组合 token 化、RPN 转换与求值
 */
function evaluateExpression(expr) {
  if (!expr) {
    throw new Error("错误：表达式为空");
  }
  const tokens = tokenize(expr);
  const rpn = infixToRPN(tokens);
  const value = evaluateRPN(rpn);
  return value;
}

/**
 * 计算按钮处理：= 
 */
function calculateResult() {
  if (!currentExpression) return;

  try {
    const value = evaluateExpression(currentExpression);
    const formatted = formatResult(value);
    resultDisplay.textContent = formatted;
    lastResultValue = value;
    justEvaluated = true;
    hasError = false;
    // 记录历史
    addHistoryItem(currentExpression, formatted);
  } catch (err) {
    // 错误提示：显示在结果区域，同时设置错误状态
    resultDisplay.textContent =
      err && err.message ? err.message : "错误：表达式无效";
    justEvaluated = false;
    hasError = true;
  }
}

// ========================
// 历史记录管理
// ========================

/**
 * 新增一条历史记录（保留最近 10 条）
 */
function addHistoryItem(expression, result) {
  const item = { expression, result };
  historyItems.push(item);
  if (historyItems.length > 10) {
    historyItems.shift();
  }
  renderHistory();
}

/**
 * 渲染历史记录列表
 */
function renderHistory() {
  historyList.innerHTML = "";

  if (historyItems.length === 0) {
    historyEmptyText.style.display = "block";
    return;
  }

  historyEmptyText.style.display = "none";

  historyItems
    .slice()
    .reverse()
    .forEach((item, indexFromEnd) => {
      const li = document.createElement("li");
      li.className = "history-item";
      // 在 data-index 中记录在数组中的真实索引
      const realIndex = historyItems.length - 1 - indexFromEnd;
      li.dataset.index = String(realIndex);

      const exprDiv = document.createElement("div");
      exprDiv.className = "history-item-expression";
      exprDiv.textContent = formatExpressionForDisplay(item.expression);

      const resDiv = document.createElement("div");
      resDiv.className = "history-item-result";
      resDiv.textContent = item.result;

      li.appendChild(exprDiv);
      li.appendChild(resDiv);

      historyList.appendChild(li);
    });
}

/**
 * 清空历史记录
 */
function clearHistory() {
  historyItems = [];
  renderHistory();
}

/**
 * 点击历史记录项：将其表达式重新填入并重新计算
 */
function handleHistoryClick(event) {
  const target = event.target.closest(".history-item");
  if (!target) return;
  const index = Number(target.dataset.index);
  if (Number.isNaN(index) || !historyItems[index]) return;

  const item = historyItems[index];
  currentExpression = item.expression;
  updateDisplays();
  // 重新计算一次，保证逻辑一致
  calculateResult();
}

/**
 * 历史面板折叠/展开
 */
function toggleHistoryPanel() {
  historyPanel.classList.toggle("collapsed");
}

/**
 * 根据屏幕宽度设置历史面板默认折叠状态：
 * - 手机（<=600px）默认折叠
 * - 更大屏幕默认展开
 */
function initHistoryPanelState() {
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  if (isMobile) {
    historyPanel.classList.add("collapsed");
  } else {
    historyPanel.classList.remove("collapsed");
  }
}

// ========================
// 主题切换逻辑
// ========================

/**
 * 初始化主题：从 localStorage 读取用户选择，否则默认为 auto（跟随系统）
 */
function initTheme() {
  const stored = window.localStorage.getItem("calculator-theme-mode");
  if (stored === "light" || stored === "dark" || stored === "auto") {
    themeMode = stored;
  } else {
    themeMode = "auto";
  }
  applyTheme();
}

/**
 * 根据 themeMode 应用主题，并更新按钮文案
 */
function applyTheme() {
  if (themeMode === "auto") {
    rootElement.setAttribute("data-theme", "auto");
  } else {
    rootElement.setAttribute("data-theme", themeMode);
  }

  // 更新按钮文案
  const labelSpan = themeToggleButton.querySelector(".mode-label");
  const indicatorSpan = themeToggleButton.querySelector(".mode-indicator");
  if (!labelSpan || !indicatorSpan) return;

  if (themeMode === "auto") {
    labelSpan.textContent = "跟随系统";
    indicatorSpan.textContent = "●";
  } else if (themeMode === "light") {
    labelSpan.textContent = "浅色模式";
    indicatorSpan.textContent = "日";
  } else {
    labelSpan.textContent = "深色模式";
    indicatorSpan.textContent = "夜";
  }
}

/**
 * 切换主题：auto -> light -> dark -> auto 循环
 */
function cycleThemeMode() {
  if (themeMode === "auto") {
    themeMode = "light";
  } else if (themeMode === "light") {
    themeMode = "dark";
  } else {
    themeMode = "auto";
  }
  window.localStorage.setItem("calculator-theme-mode", themeMode);
  applyTheme();
}

// ========================
// 键盘输入支持
// ========================

/**
 * 处理键盘按键
 */
function handleKeyDown(event) {
  const key = event.key;

  // 数字
  if (key >= "0" && key <= "9") {
    appendDigit(key);
    return;
  }

  // 运算符
  if ("+-*/%^".includes(key)) {
    appendOperator(key);
    event.preventDefault();
    return;
  }

  // 括号
  if (key === "(" || key === ")") {
    appendParenthesis(key);
    event.preventDefault();
    return;
  }

  // 小数点
  if (key === ".") {
    appendDecimalPoint();
    event.preventDefault();
    return;
  }

  // 回车或等号：计算
  if (key === "Enter" || key === "=") {
    calculateResult();
    event.preventDefault();
    return;
  }

  // 退格：DEL
  if (key === "Backspace") {
    deleteLast();
    event.preventDefault();
    return;
  }

  // Esc：AC
  if (key === "Escape") {
    clearAll();
    event.preventDefault();
    return;
  }
}

// ========================
// 事件绑定
// ========================

/**
 * 处理数字/运算符等按钮点击（使用事件代理）
 */
function handleKeypadClick(event) {
  const button = event.target.closest(".key");
  if (!button) return;

  const action = button.dataset.action;
  const type = button.dataset.type;
  const value = button.dataset.value;

  if (action) {
    switch (action) {
      case "clear":
        clearAll();
        break;
      case "delete":
        deleteLast();
        break;
      case "toggle-sign":
        toggleSign();
        break;
      case "decimal":
        appendDecimalPoint();
        break;
      case "sqrt":
        appendSqrt();
        break;
      case "equals":
        calculateResult();
        break;
      default:
        break;
    }
    return;
  }

  if (type === "number") {
    appendDigit(value);
  } else if (type === "operator") {
    appendOperator(value);
  } else if (type === "parenthesis") {
    appendParenthesis(value);
  }
}

// ========================
// 初始化
// ========================

function init() {
  // 初始化历史面板默认折叠状态
  initHistoryPanelState();

  // 渲染空历史
  renderHistory();

  // 初始化主题
  initTheme();

  // 绑定按键区域点击事件
  keypad.addEventListener("click", handleKeypadClick);

  // 历史记录：点击折叠/展开
  historyHeader.addEventListener("click", function (event) {
    // 避免点击“清空”按钮时也折叠
    if (event.target.closest("#historyClearButton")) return;
    toggleHistoryPanel();
  });

  // 历史记录：清空按钮
  historyClearButton.addEventListener("click", function (event) {
    event.stopPropagation(); // 防止触发折叠
    clearHistory();
  });

  // 历史记录：点击某一条记录
  historyList.addEventListener("click", handleHistoryClick);

  // 主题切换按钮
  themeToggleButton.addEventListener("click", cycleThemeMode);

  // 键盘输入
  document.addEventListener("keydown", handleKeyDown);

  // 窗口尺寸变化时，重新评估历史面板默认折叠状态（仅首次放大/缩小时有意义）
  window.addEventListener("resize", initHistoryPanelState);
}

// DOM 加载完成后初始化
document.addEventListener("DOMContentLoaded", init);

