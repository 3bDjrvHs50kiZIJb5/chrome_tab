const bookmarkAnalyzerForm = document.getElementById("bookmark-analyzer-form");
const quickOpenForm = document.getElementById("bookmark-quick-open-form");
const quickOpenInput = document.getElementById("bookmark-quick-open-input");
const quickOpenClearButton = document.getElementById("bookmark-quick-open-clear-btn");
const recentTabSearchForm = document.getElementById("recent-tab-search-form");
const recentTabSearchInput = document.getElementById("recent-tab-search-input");
const recentTabSearchClearButton = document.getElementById("recent-tab-search-clear-btn");
const dustModal = document.getElementById("dust-modal");
const flipModal = document.getElementById("flip-modal");
const refreshExtensionButton = document.getElementById("refresh-extension-btn");
const openDustModalButton = document.getElementById("open-dust-modal-btn");
const openFlipModalButton = document.getElementById("open-flip-modal-btn");
const closeDustModalButton = document.getElementById("close-dust-modal-btn");
const closeFlipModalButton = document.getElementById("close-flip-modal-btn");
const dustModalBackdrop = document.getElementById("dust-modal-backdrop");
const flipModalBackdrop = document.getElementById("flip-modal-backdrop");
const inactiveDaysInput = document.getElementById("inactive-days");
const historyDaysInput = document.getElementById("history-days");
const minVisitsInput = document.getElementById("min-visits");
const flipFolderSelect = document.getElementById("flip-folder-select");
const moveDustButton = document.getElementById("move-dust-btn");
const saveFlipButton = document.getElementById("save-flip-btn");
const quickOpenTip = document.getElementById("quick-open-tip");
const quickOpenEmpty = document.getElementById("quick-open-empty");
const quickOpenList = document.getElementById("quick-open-list");
const shortcutEmpty = document.getElementById("shortcut-empty");
const shortcutList = document.getElementById("shortcut-list");
const folderBookmarkEmpty = document.getElementById("folder-bookmark-empty");
const folderBookmarkList = document.getElementById("folder-bookmark-list");
const recentTabEmpty = document.getElementById("recent-tab-empty");
const recentTabList = document.getElementById("recent-tab-list");
const analysisEmpty = document.getElementById("analysis-empty");
const analysisSummary = document.getElementById("analysis-summary");
const analysisList = document.getElementById("analysis-list");
const flipEmpty = document.getElementById("flip-empty");
const flipSummary = document.getElementById("flip-summary");
const flipList = document.getElementById("flip-list");
const message = document.getElementById("message");
const shortcutItemTemplate = document.getElementById("shortcut-item-template");
const analysisItemTemplate = document.getElementById("analysis-item-template");
const flipItemTemplate = document.getElementById("flip-item-template");
const UNDO_WINDOW_MS = 10_000;
const SHORTCUT_PREFERENCES_KEY = "chrome-tab-shortcut-preferences-v1";
const RECENT_TAB_DISMISSALS_KEY = "chrome-tab-recent-tab-dismissals-v1";

let bookmarkCandidates = [];
let frequentHistoryCandidates = [];
let shortcutCandidates = [];
let topShortcuts = [];
let searchableBookmarks = [];
let quickOpenMatches = [];
let folderBookmarkGroups = [];
let recentClosedTabs = [];
let shortcutPreferences = loadShortcutPreferences();
let dismissedRecentTabKeys = loadRecentTabDismissals();
let draggedShortcutKey = "";
let quickOpenActiveIndex = -1;
let quickOpenImeComposing = false;
let frequentHistoryAnalysisRequestId = 0;
let activeLoadingToast = null;
let activeUndoToast = null;
let pendingUndoAction = null;
let undoExpireTimer = null;
let undoTickTimer = null;
let undoInProgress = false;

bookmarkAnalyzerForm.addEventListener("submit", handleAnalyzeBookmarks);
if (quickOpenForm && quickOpenInput) {
  quickOpenForm.addEventListener("submit", handleQuickOpenSubmit);
  quickOpenInput.addEventListener("input", handleQuickOpenInput);
  quickOpenInput.addEventListener("keydown", handleQuickOpenInputKeydown);
  quickOpenInput.addEventListener("compositionstart", handleQuickOpenCompositionStart);
  quickOpenInput.addEventListener("compositionend", handleQuickOpenCompositionEnd);
  if (quickOpenClearButton) {
    quickOpenClearButton.addEventListener("click", handleQuickOpenClearClick);
  }
}
if (recentTabSearchForm && recentTabSearchInput) {
  recentTabSearchForm.addEventListener("submit", handleRecentTabSearchSubmit);
  recentTabSearchInput.addEventListener("input", handleRecentTabSearchInput);
  if (recentTabSearchClearButton) {
    recentTabSearchClearButton.addEventListener("click", handleRecentTabSearchClearClick);
  }
}
historyDaysInput.addEventListener("change", handleFrequentHistoryFilterChange);
minVisitsInput.addEventListener("change", handleFrequentHistoryFilterChange);
if (refreshExtensionButton) {
  refreshExtensionButton.addEventListener("click", handleRefreshExtension);
}
openDustModalButton.addEventListener("click", openDustModal);
openFlipModalButton.addEventListener("click", openFlipModal);
closeDustModalButton.addEventListener("click", closeDustModal);
closeFlipModalButton.addEventListener("click", closeFlipModal);
dustModalBackdrop.addEventListener("click", closeDustModal);
flipModalBackdrop.addEventListener("click", closeFlipModal);
moveDustButton.addEventListener("click", handleMoveDustBookmarks);
saveFlipButton.addEventListener("click", handleSaveFlipBookmarks);
document.addEventListener("keydown", handleModalKeydown);
if (shortcutList) {
  shortcutList.addEventListener("dragover", handleShortcutListDragOver);
  shortcutList.addEventListener("drop", handleShortcutListDrop);
}

init().catch((error) => {
  console.error(error);
  showMessage("初始化失败了，请关掉弹窗再试一次。", true);
});

async function init() {
  searchableBookmarks = await getSearchableBookmarks();
  await refreshShortcutData();
  folderBookmarkGroups = await getFolderBookmarkGroups();
  recentClosedTabs = await getRecentlyClosedTabs();
  await renderBookmarkFolderOptions();
  render();
}

async function refreshShortcutData() {
  shortcutCandidates = await getShortcutCandidates();
  topShortcuts = getTopBookmarkShortcuts(shortcutCandidates);
}

async function handleAnalyzeBookmarks(event) {
  event.preventDefault();

  const inactiveDays = Number.parseInt(inactiveDaysInput.value, 10);
  showMessage("正在分析收藏夹，请稍等...");
  moveDustButton.disabled = true;

  try {
    bookmarkCandidates = await findInactiveBookmarks(inactiveDays);
    renderAnalysis(inactiveDays);

    if (bookmarkCandidates.length === 0) {
      showMessage(`最近 ${inactiveDays} 天内，你的收藏夹看起来都还挺常用。`);
      return;
    }

    showMessage(`已经找出 ${bookmarkCandidates.length} 个可能在“吃灰”的收藏。`);
  } catch (error) {
    console.error(error);
    showMessage("分析收藏夹失败了，请再试一次。", true);
  }
}

async function handleMoveDustBookmarks() {
  if (bookmarkCandidates.length === 0) {
    showMessage("现在没有可整理的收藏。", true);
    return;
  }

  try {
    const movedCandidates = bookmarkCandidates.map((item) => ({ ...item }));
    const bookmarkNodes = await chrome.bookmarks.get(movedCandidates.map((item) => item.id));
    const originalLocations = bookmarkNodes
      .filter((node) => node.id && node.parentId)
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        index: typeof node.index === "number" ? node.index : null
      }));
    const dustFolderId = await ensureDustFolder();

    for (const item of movedCandidates) {
      await chrome.bookmarks.move(item.id, { parentId: dustFolderId });
    }

    const movedCount = movedCandidates.length;
    bookmarkCandidates = [];
    searchableBookmarks = await getSearchableBookmarks();
    await refreshShortcutData();
    folderBookmarkGroups = await getFolderBookmarkGroups();
    renderAnalysis(Number.parseInt(inactiveDaysInput.value, 10));
    renderQuickOpenMatches(getQuickOpenKeyword());
    renderShortcuts();
    renderFolderBookmarks();
    closeDustModal();
    showMessage(`已经把 ${movedCount} 个不常访问的收藏挪进“吃灰”文件夹。`);
    startUndoAction({
      text: `刚刚移动了 ${movedCount} 个收藏到“吃灰”`,
      async undo() {
        const locations = [...originalLocations].sort((a, b) => {
          if (a.parentId !== b.parentId) {
            return a.parentId.localeCompare(b.parentId, "zh-CN");
          }
          return (a.index ?? 0) - (b.index ?? 0);
        });

        for (const item of locations) {
          const moveInfo = { parentId: item.parentId };
          if (typeof item.index === "number") {
            moveInfo.index = item.index;
          }
          await chrome.bookmarks.move(item.id, moveInfo);
        }

        bookmarkCandidates = movedCandidates;
        searchableBookmarks = await getSearchableBookmarks();
        await refreshShortcutData();
        folderBookmarkGroups = await getFolderBookmarkGroups();
        renderAnalysis(Number.parseInt(inactiveDaysInput.value, 10));
        renderQuickOpenMatches(getQuickOpenKeyword());
        renderShortcuts();
        renderFolderBookmarks();
        return `已经撤销，${movedCount} 个收藏回到原来的位置了。`;
      }
    });
  } catch (error) {
    console.error(error);
    showMessage("整理收藏夹失败了，请再试一次。", true);
  }
}

async function analyzeFrequentHistory() {
  const historyDays = Number.parseInt(historyDaysInput.value, 10);
  const minVisits = Number.parseInt(minVisitsInput.value, 10);
  const requestId = ++frequentHistoryAnalysisRequestId;
  const previouslySelectedUrls = new Set(
    frequentHistoryCandidates.filter((item) => item.selected).map((item) => item.url)
  );

  renderFlipLoadingState();
  showMessage("正在翻历史记录，请稍等...");
  saveFlipButton.disabled = true;

  try {
    const nextCandidates = await findFrequentHistoryItems(historyDays, minVisits);
    if (requestId !== frequentHistoryAnalysisRequestId) {
      return;
    }

    frequentHistoryCandidates = nextCandidates.map((item) => ({
      ...item,
      selected: previouslySelectedUrls.has(item.url)
    }));
    renderFlipAnalysis(historyDays, minVisits);

    if (frequentHistoryCandidates.length === 0) {
      showMessage(`最近 ${historyDays} 天里，没有发现明显该补进收藏夹的网址。`);
      return;
    }

    showMessage(`已经找出 ${frequentHistoryCandidates.length} 个值得“翻牌”的网址。`);
  } catch (error) {
    if (requestId !== frequentHistoryAnalysisRequestId) {
      return;
    }
    console.error(error);
    showMessage("分析高频网址失败了，请再试一次。", true);
  }
}

function handleFrequentHistoryFilterChange() {
  if (flipModal.hidden) {
    return;
  }

  analyzeFrequentHistory().catch((error) => {
    console.error(error);
    showMessage("分析高频网址失败了，请再试一次。", true);
  });
}

async function handleSaveFlipBookmarks() {
  if (frequentHistoryCandidates.length === 0) {
    showMessage("现在没有可加入收藏夹的网址。", true);
    return;
  }

  const selectedItems = frequentHistoryCandidates.filter((item) => item.selected);

  if (selectedItems.length === 0) {
    showMessage("先勾选你想加入收藏夹的网址。", true);
    return;
  }

  try {
    const targetFolderId = await ensureTargetBookmarkFolder();

    for (const item of selectedItems) {
      await chrome.bookmarks.create({
        parentId: targetFolderId,
        title: item.title || item.url,
        url: item.url
      });
    }

    const savedCount = selectedItems.length;
    frequentHistoryCandidates = frequentHistoryCandidates.filter((item) => !item.selected);
    searchableBookmarks = await getSearchableBookmarks();
    await refreshShortcutData();
    folderBookmarkGroups = await getFolderBookmarkGroups();
    await renderBookmarkFolderOptions();
    renderQuickOpenMatches(getQuickOpenKeyword());
    renderFlipAnalysis(
      Number.parseInt(historyDaysInput.value, 10),
      Number.parseInt(minVisitsInput.value, 10)
    );
    renderShortcuts();
    renderFolderBookmarks();
    showMessage(`已经把 ${savedCount} 个网址加入你选中的收藏夹。`);
  } catch (error) {
    console.error(error);
    showMessage("加入收藏夹失败了，请再试一次。", true);
  }
}

/** 仅保留 ASCII 可打印字符（英文、数字、常见符号），无法用 HTML 强制切换输入法，只能拒绝中文等上屏 */
function sanitizeQuickOpenAsciiOnly(raw) {
  return raw.replace(/[^\x20-\x7E]/g, "");
}

function applyQuickOpenAsciiOnly(input) {
  const raw = input.value;
  const clean = sanitizeQuickOpenAsciiOnly(raw);
  if (raw === clean) {
    return;
  }
  const pos = input.selectionStart;
  const before = typeof pos === "number" ? raw.slice(0, pos) : raw;
  const newPos = sanitizeQuickOpenAsciiOnly(before).length;
  input.value = clean;
  input.setSelectionRange(newPos, newPos);
}

function handleQuickOpenCompositionStart() {
  quickOpenImeComposing = true;
}

function handleQuickOpenCompositionEnd(event) {
  quickOpenImeComposing = false;
  applyQuickOpenAsciiOnly(event.target);
  renderQuickOpenMatches(event.target.value);
  syncQuickOpenClearButton();
}

function handleQuickOpenInput(event) {
  if (quickOpenImeComposing) {
    return;
  }
  applyQuickOpenAsciiOnly(event.target);
  renderQuickOpenMatches(event.target.value);
  syncQuickOpenClearButton();
}

function handleQuickOpenInputKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    handleQuickOpenClearClick();
    return;
  }

  if (quickOpenMatches.length === 0) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    quickOpenActiveIndex = (quickOpenActiveIndex + 1) % quickOpenMatches.length;
    renderQuickOpenMatches(getQuickOpenKeyword(), { preserveActiveIndex: true });
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    quickOpenActiveIndex = (quickOpenActiveIndex - 1 + quickOpenMatches.length) % quickOpenMatches.length;
    renderQuickOpenMatches(getQuickOpenKeyword(), { preserveActiveIndex: true });
  }
}

function handleQuickOpenClearClick() {
  if (!quickOpenInput) {
    return;
  }

  quickOpenInput.value = "";
  renderQuickOpenMatches("");
  syncQuickOpenClearButton();
  refocusQuickOpenInput();
}

function handleRecentTabSearchInput(event) {
  renderRecentClosedTabs(event.target.value);
  syncRecentTabSearchClearButton();
}

function handleRecentTabSearchSubmit(event) {
  event.preventDefault();
  renderRecentClosedTabs(getRecentTabKeyword());
}

function handleRecentTabSearchClearClick() {
  if (!recentTabSearchInput) {
    return;
  }

  recentTabSearchInput.value = "";
  renderRecentClosedTabs("");
  syncRecentTabSearchClearButton();
  recentTabSearchInput.focus();
}

async function handleQuickOpenSubmit(event) {
  event.preventDefault();
  const keyword = getQuickOpenKeyword().trim();
  renderQuickOpenMatches(keyword, { preserveActiveIndex: true });

  if (!keyword) {
    showMessage("先输入关键词，再回车打开。", true);
    refocusQuickOpenInput();
    return;
  }

  if (isLikelyUrlInput(keyword)) {
    const directUrl = normalizeUrl(keyword);
    if (directUrl) {
      try {
        await openBookmarkUrl(directUrl);
        showMessage(`已经直接打开：${directUrl}`);
      } catch (error) {
        console.error(error);
        showMessage("直接打开网址失败了，请再试一次。", true);
      } finally {
        refocusQuickOpenInput();
      }
      return;
    }
  }

  if (quickOpenMatches.length === 0) {
    try {
      await openBookmarkUrl(buildGoogleSearchUrl(keyword));
      showMessage(`没有匹配收藏，已用 Google 搜索：${keyword}`);
    } catch (error) {
      console.error(error);
      showMessage("打开 Google 搜索失败了，请再试一次。", true);
    } finally {
      refocusQuickOpenInput();
    }
    return;
  }

  try {
    const selectedMatch = quickOpenMatches[quickOpenActiveIndex] || quickOpenMatches[0];
    await openUrlInNewTabGroup(selectedMatch.url, getBookmarkGroupTitle(selectedMatch));
    showMessage(`已经打开：${selectedMatch.title || selectedMatch.domainLabel}`);
  } catch (error) {
    console.error(error);
    showMessage("打开网址失败了，请再试一次。", true);
  } finally {
    refocusQuickOpenInput();
  }
}

function refocusQuickOpenInput() {
  if (!quickOpenInput || quickOpenInput.disabled) {
    return;
  }

  window.setTimeout(() => {
    if (quickOpenInput.hidden || quickOpenInput.offsetParent === null) {
      return;
    }

    quickOpenInput.focus();
    quickOpenInput.setSelectionRange(quickOpenInput.value.length, quickOpenInput.value.length);
  }, 0);
}

function openDustModal() {
  dustModal.hidden = false;
  syncBodyScrollState();
  window.setTimeout(() => {
    inactiveDaysInput.focus();
  }, 0);
}

function closeDustModal() {
  dustModal.hidden = true;
  syncBodyScrollState();
}

function handleRefreshExtension() {
  showMessage("正在刷新插件...");
  window.setTimeout(() => {
    chrome.runtime.reload();
  }, 120);
}

async function openFlipModal() {
  await renderBookmarkFolderOptions();
  flipModal.hidden = false;
  syncBodyScrollState();
  window.setTimeout(() => {
    historyDaysInput.focus();
  }, 0);
  analyzeFrequentHistory().catch((error) => {
    console.error(error);
    showMessage("分析高频网址失败了，请再试一次。", true);
  });
}

function closeFlipModal() {
  flipModal.hidden = true;
  syncBodyScrollState();
}

function syncBodyScrollState() {
  const hasOpenModal = !dustModal.hidden || !flipModal.hidden;
  document.body.style.overflow = hasOpenModal ? "hidden" : "";
}

function handleModalKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (!dustModal.hidden) {
    closeDustModal();
    return;
  }

  if (!flipModal.hidden) {
    closeFlipModal();
    return;
  }
}

function render() {
  renderQuickOpenMatches(getQuickOpenKeyword());
  syncQuickOpenClearButton();
  renderShortcuts();
  renderFolderBookmarks();
  renderRecentClosedTabs(getRecentTabKeyword());
  syncRecentTabSearchClearButton();
}

function syncQuickOpenClearButton() {
  if (!quickOpenInput || !quickOpenClearButton) {
    return;
  }

  quickOpenClearButton.hidden = quickOpenInput.value.length === 0;
}

function syncRecentTabSearchClearButton() {
  if (!recentTabSearchInput || !recentTabSearchClearButton) {
    return;
  }

  recentTabSearchClearButton.hidden = recentTabSearchInput.value.length === 0;
}

function renderQuickOpenMatches(keyword, options = {}) {
  const { preserveActiveIndex = false } = options;

  if (!quickOpenList || !quickOpenTip || !quickOpenEmpty) {
    quickOpenMatches = [];
    quickOpenActiveIndex = -1;
    return;
  }

  quickOpenList.innerHTML = "";

  const trimmedKeyword = keyword.trim();
  quickOpenMatches = trimmedKeyword ? findBookmarkMatches(trimmedKeyword) : [];

  if (quickOpenMatches.length === 0) {
    quickOpenActiveIndex = -1;
  } else if (!preserveActiveIndex || quickOpenActiveIndex < 0 || quickOpenActiveIndex >= quickOpenMatches.length) {
    quickOpenActiveIndex = 0;
  }

  quickOpenTip.hidden = Boolean(trimmedKeyword);
  quickOpenEmpty.hidden = !trimmedKeyword || quickOpenMatches.length > 0;

  if (!trimmedKeyword || quickOpenMatches.length === 0) {
    return;
  }

  for (const [index, item] of quickOpenMatches.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-open-item${index === quickOpenActiveIndex ? " is-best-match" : ""}`;

    const titleRow = document.createElement("div");
    titleRow.className = "quick-open-title-row";

    const title = document.createElement("div");
    title.className = "quick-open-title";
    title.textContent = item.title || item.domainLabel || "未命名收藏";

    const tag = document.createElement("span");
    tag.className = "quick-open-tag";
    tag.textContent = index === quickOpenActiveIndex ? "回车直达" : "可打开";

    const url = document.createElement("div");
    url.className = "quick-open-url";
    url.textContent = item.url;

    const folder = document.createElement("div");
    folder.className = "quick-open-folder";
    folder.textContent = item.folderLabel ? `收藏夹：${item.folderLabel}` : "收藏夹：未命名";

    titleRow.append(title, tag);
    button.append(titleRow, url, folder);
    button.addEventListener("click", async () => {
      try {
        quickOpenActiveIndex = index;
        renderQuickOpenMatches(getQuickOpenKeyword(), { preserveActiveIndex: true });
        await openUrlInNewTabGroup(item.url, getBookmarkGroupTitle(item));
        showMessage(`已经打开：${item.title || item.domainLabel}`);
      } catch (error) {
        console.error(error);
        showMessage("打开网址失败了，请再试一次。", true);
      }
    });

    quickOpenList.appendChild(button);
  }
}

function renderShortcuts() {
  shortcutList.innerHTML = "";

  if (topShortcuts.length === 0) {
    shortcutEmpty.hidden = false;
    return;
  }

  shortcutEmpty.hidden = true;

  for (const item of topShortcuts) {
    const fragment = shortcutItemTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".shortcut-card");
    const button = fragment.querySelector(".shortcut-item");
    const icon = fragment.querySelector(".shortcut-icon");
    const iconFallback = fragment.querySelector(".shortcut-icon-fallback");
    const name = fragment.querySelector(".shortcut-name");
    const pinButton = fragment.querySelector(".shortcut-pin-btn");
    const clearButton = fragment.querySelector(".shortcut-clear-btn");

    card.dataset.shortcutKey = item.domainKey;
    button.draggable = false;
    pinButton.draggable = false;
    clearButton.draggable = false;
    icon.draggable = false;
    button.title = item.title || item.domainLabel;
    icon.alt = `${item.title || item.domainLabel} 图标`;
    setupShortcutIcon(icon, iconFallback, item.url, item.title || item.domainLabel);
    name.textContent = item.shortLabel;
    pinButton.classList.toggle("is-active", item.isPinned);
    pinButton.title = item.isPinned ? "取消固定" : "固定到前面";
    pinButton.setAttribute("aria-label", item.isPinned ? "取消固定" : "固定到前面");
    clearButton.title = "从常用里清零";
    clearButton.setAttribute("aria-label", "从常用里清零");

    button.addEventListener("click", async () => {
      try {
        await openUrlInNewTabGroup(item.url, getBookmarkGroupTitle(item));
        showMessage(`已经打开：${item.shortLabel}`);
      } catch (error) {
        console.error(error);
        showMessage("打开网址失败了，请再试一次。", true);
      }
    });

    pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleShortcutPinClick(item).catch((error) => {
        console.error(error);
        showMessage("固定常用网站失败了，请再试一次。", true);
      });
    });

    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleShortcutClearClick(item).catch((error) => {
        console.error(error);
        showMessage("清零常用网站失败了，请再试一次。", true);
      });
    });

    card.addEventListener("dragstart", (event) => handleShortcutDragStart(event, item.domainKey));
    card.addEventListener("dragover", handleShortcutDragOver);
    card.addEventListener("dragleave", handleShortcutDragLeave);
    card.addEventListener("drop", (event) => {
      handleShortcutDrop(event, item.domainKey);
    });
    card.addEventListener("dragend", handleShortcutDragEnd);

    shortcutList.appendChild(fragment);
  }
}

async function handleShortcutPinClick(item) {
  const snapshot = cloneShortcutPreferences(shortcutPreferences);
  const isPinned = Boolean(shortcutPreferences.pinned[item.domainKey]);

  if (isPinned) {
    delete shortcutPreferences.pinned[item.domainKey];
  } else {
    shortcutPreferences.pinned[item.domainKey] = true;
  }

  saveShortcutPreferences();
  topShortcuts = getTopBookmarkShortcuts(shortcutCandidates);
  renderShortcuts();
  showMessage(isPinned ? `已经取消固定：${item.shortLabel}` : `已经固定到前面：${item.shortLabel}`);
  startUndoAction({
    text: isPinned ? `刚刚取消固定了 ${item.shortLabel}` : `刚刚固定了 ${item.shortLabel}`,
    async undo() {
      restoreShortcutPreferences(snapshot);
      return isPinned ? `已经撤销，${item.shortLabel} 又固定回前面了。` : `已经撤销，${item.shortLabel} 不再固定了。`;
    }
  });
}

async function handleShortcutClearClick(item) {
  const snapshot = cloneShortcutPreferences(shortcutPreferences);
  delete shortcutPreferences.pinned[item.domainKey];
  shortcutPreferences.cleared[item.domainKey] = Math.max(0, item.rawVisitCount || item.visitCount || 0);
  shortcutPreferences.order = shortcutPreferences.order.filter((key) => key !== item.domainKey);
  saveShortcutPreferences();
  topShortcuts = getTopBookmarkShortcuts(shortcutCandidates);
  renderShortcuts();
  showMessage(`已经从常用里清零：${item.shortLabel}`);
  startUndoAction({
    text: `刚刚把 ${item.shortLabel} 从常用里清零了`,
    async undo() {
      restoreShortcutPreferences(snapshot);
      return `已经撤销，${item.shortLabel} 回到常用网站里了。`;
    }
  });
}

function handleShortcutDragStart(event, shortcutKey) {
  draggedShortcutKey = shortcutKey;
  const card = event.currentTarget;
  if (card instanceof HTMLElement) {
    card.classList.add("is-dragging");
  }

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", shortcutKey);
  }
}

function handleShortcutDragOver(event) {
  event.preventDefault();
  const card = event.currentTarget;
  if (!(card instanceof HTMLElement) || !draggedShortcutKey) {
    return;
  }

  shortcutList.querySelectorAll(".shortcut-card").forEach((item) => {
    if (item !== card) {
      item.classList.remove("is-drop-target");
    }
  });

  if (card.dataset.shortcutKey === draggedShortcutKey) {
    card.classList.remove("is-drop-target");
    return;
  }

  card.classList.add("is-drop-target");
}

function handleShortcutDragLeave(event) {
  const card = event.currentTarget;
  if (!(card instanceof HTMLElement)) {
    return;
  }

  card.classList.remove("is-drop-target");
}

function handleShortcutDrop(event, targetShortcutKey) {
  event.preventDefault();
  const card = event.currentTarget;
  if (card instanceof HTMLElement) {
    card.classList.remove("is-drop-target");
  }

  if (!draggedShortcutKey || draggedShortcutKey === targetShortcutKey) {
    return;
  }

  moveShortcutToNewPosition(targetShortcutKey);
}

function handleShortcutListDragOver(event) {
  if (!draggedShortcutKey) {
    return;
  }

  event.preventDefault();
}

function handleShortcutListDrop(event) {
  if (!draggedShortcutKey) {
    return;
  }

  const targetCard = event.target instanceof Element ? event.target.closest(".shortcut-card") : null;
  if (targetCard) {
    return;
  }

  event.preventDefault();
  moveShortcutToNewPosition(null);
}

function handleShortcutDragEnd(event) {
  const card = event.currentTarget;
  if (card instanceof HTMLElement) {
    card.classList.remove("is-dragging");
    card.classList.remove("is-drop-target");
  }

  clearShortcutDragState();
}

function moveShortcutToNewPosition(targetShortcutKey) {
  const visibleKeys = topShortcuts.map((item) => item.domainKey);
  const fromIndex = visibleKeys.indexOf(draggedShortcutKey);

  if (fromIndex < 0) {
    clearShortcutDragState();
    return;
  }

  const reorderedKeys = [...visibleKeys];
  const [draggedKey] = reorderedKeys.splice(fromIndex, 1);

  if (!targetShortcutKey) {
    reorderedKeys.push(draggedKey);
  } else {
    const targetIndex = reorderedKeys.indexOf(targetShortcutKey);
    if (targetIndex < 0) {
      reorderedKeys.push(draggedKey);
    } else {
      reorderedKeys.splice(targetIndex, 0, draggedKey);
    }
  }

  const snapshot = cloneShortcutPreferences(shortcutPreferences);
  applyShortcutManualOrder(reorderedKeys);
  topShortcuts = getTopBookmarkShortcuts(shortcutCandidates);
  renderShortcuts();
  clearShortcutDragState();
  showMessage("常用网站顺序已经更新。");
  startUndoAction({
    text: "刚刚调整了常用网站顺序",
    async undo() {
      restoreShortcutPreferences(snapshot);
      return "已经撤销，常用网站顺序回到刚才的样子了。";
    }
  });
}

function clearShortcutDragState() {
  draggedShortcutKey = "";
  shortcutList.querySelectorAll(".shortcut-card").forEach((card) => {
    card.classList.remove("is-dragging");
    card.classList.remove("is-drop-target");
  });
}

function renderFolderBookmarks() {
  if (!folderBookmarkList || !folderBookmarkEmpty) {
    return;
  }

  folderBookmarkList.innerHTML = "";

  if (folderBookmarkGroups.length === 0) {
    folderBookmarkEmpty.hidden = false;
    return;
  }

  folderBookmarkEmpty.hidden = true;

  for (const group of folderBookmarkGroups) {
    const details = document.createElement("details");
    details.className = "folder-group";
    details.open = false;

    const summary = document.createElement("summary");
    summary.className = "folder-group-summary";

    const title = document.createElement("span");
    title.className = "folder-group-title";
    title.textContent = group.label;

    const count = document.createElement("span");
    count.className = "folder-group-count";
    count.textContent = `${group.items.length} 个网址`;

    summary.append(title, count);

    const content = document.createElement("div");
    content.className = "folder-group-content";

    for (const item of group.items) {
      const linkButton = document.createElement("button");
      linkButton.type = "button";
      linkButton.className = "folder-link";

      const linkTitle = document.createElement("span");
      linkTitle.className = "folder-link-title";
      linkTitle.textContent = item.title || item.domainLabel || "未命名收藏";

      const linkUrl = document.createElement("span");
      linkUrl.className = "folder-link-url";
      linkUrl.textContent = item.url;

      linkButton.append(linkTitle, linkUrl);
      linkButton.addEventListener("click", async () => {
        try {
          await openUrlInNewTabGroup(item.url, group.groupTitle);
          showMessage(`已经打开：${item.title || item.domainLabel}`);
        } catch (error) {
          console.error(error);
          showMessage("打开网址失败了，请再试一次。", true);
        }
      });

      content.appendChild(linkButton);
    }

    details.append(summary, content);
    folderBookmarkList.appendChild(details);
  }
}

function renderRecentClosedTabs(keyword = "") {
  if (!recentTabList || !recentTabEmpty) {
    return;
  }

  recentTabList.innerHTML = "";
  recentTabEmpty.textContent = "还没有可显示的最近关闭标签页。";

  const filteredTabs = findRecentClosedTabMatches(keyword);

  if (recentClosedTabs.length === 0) {
    recentTabEmpty.hidden = false;
    return;
  }

  if (filteredTabs.length === 0) {
    recentTabEmpty.hidden = false;
    recentTabEmpty.textContent = `没有找到包含“${keyword.trim()}”的最近关闭标签页。`;
    return;
  }

  recentTabEmpty.hidden = true;

  for (const item of filteredTabs) {
    const row = document.createElement("div");
    row.className = "recent-tab-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-tab-link";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "recent-tab-delete-btn";
    deleteButton.setAttribute("aria-label", "删除这一条最近关闭");
    deleteButton.title = "删除这一条";
    deleteButton.textContent = "×";

    const title = document.createElement("span");
    title.className = "recent-tab-title";
    title.textContent = item.title || item.domainLabel || "未命名网页";

    const url = document.createElement("span");
    url.className = "recent-tab-url";
    url.textContent = item.url;
    url.title = item.url;

    const meta = document.createElement("span");
    meta.className = "recent-tab-meta";
    meta.textContent = item.closedAt
      ? `关闭时间：${formatDateTime(item.closedAt)}`
      : "关闭时间：刚刚";

    button.append(title, url, meta);
    button.addEventListener("click", async () => {
      try {
        if (item.sessionId) {
          await chrome.sessions.restore(item.sessionId);
        } else {
          await openBookmarkUrl(item.url);
        }
        recentClosedTabs = await getRecentlyClosedTabs();
        renderRecentClosedTabs(getRecentTabKeyword());
        showMessage(`已经重新打开：${item.title || item.domainLabel || item.url}`);
      } catch (error) {
        console.error(error);
        showMessage("重新打开最近关闭标签页失败了，请再试一次。", true);
      }
    });

    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleDismissRecentClosedTab(item).catch((error) => {
        console.error(error);
        showMessage("删除最近关闭记录失败了，请再试一次。", true);
      });
    });

    row.append(button, deleteButton);
    recentTabList.appendChild(row);
  }
}

async function handleDismissRecentClosedTab(item) {
  const snapshot = [...dismissedRecentTabKeys];
  dismissedRecentTabKeys.add(item.dismissKey);
  saveRecentTabDismissals();
  recentClosedTabs = recentClosedTabs.filter((tab) => tab.dismissKey !== item.dismissKey);
  renderRecentClosedTabs(getRecentTabKeyword());
  showMessage(`已经清掉：${item.title || item.domainLabel || item.url}`);
  startUndoAction({
    text: `刚刚清掉了 ${item.title || item.domainLabel || "这条最近关闭"}`,
    async undo() {
      dismissedRecentTabKeys = new Set(snapshot);
      saveRecentTabDismissals();
      recentClosedTabs = await getRecentlyClosedTabs();
      renderRecentClosedTabs(getRecentTabKeyword());
      return `已经撤销，${item.title || item.domainLabel || item.url} 又回来了。`;
    }
  });
}

async function openUrlInNewTabGroup(url, groupTitle = "常用网站") {
  const normalizedTitle = buildGroupTitle(groupTitle);
  const createdTab = await chrome.tabs.create({
    url,
    active: true
  });

  if (!createdTab.id) {
    return;
  }

  const matchedGroup = await findTabGroupByTitleInWindow(createdTab.windowId, normalizedTitle);

  if (matchedGroup) {
    await chrome.tabs.group({
      tabIds: [createdTab.id],
      groupId: matchedGroup.id
    });
    return;
  }

  const groupId = await chrome.tabs.group({ tabIds: [createdTab.id] });
  await chrome.tabGroups.update(groupId, {
    title: normalizedTitle,
    color: "blue",
    collapsed: false
  });
}

function buildGroupTitle(text) {
  const normalizedText = (text || "常用网站").trim();
  return normalizedText.length > 18 ? `${normalizedText.slice(0, 18)}...` : normalizedText;
}

function getBookmarkGroupTitle(item) {
  const groupNameFromFolder = extractPrimaryFolderGroupName(item.folderLabel || "");
  if (groupNameFromFolder) {
    return groupNameFromFolder;
  }

  return item.domainLabel || item.shortLabel || item.title || "常用网站";
}

function extractPrimaryFolderGroupName(folderLabel) {
  if (!folderLabel) {
    return "";
  }

  const parts = folderLabel
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  const rootNames = new Set([
    "书签栏",
    "其他书签",
    "移动书签",
    "Bookmarks Bar",
    "Other Bookmarks",
    "Mobile Bookmarks"
  ]);

  const customParts = parts.filter((part) => !rootNames.has(part));
  return customParts[0] || parts[0];
}

async function findTabGroupByTitleInWindow(windowId, targetTitle) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((group) => group.title === targetTitle) || null;
}

function renderAnalysis(inactiveDays) {
  analysisList.innerHTML = "";

  if (bookmarkCandidates.length === 0) {
    analysisEmpty.hidden = false;
    analysisSummary.textContent = `按“收藏里超过 ${inactiveDays} 天没打开”这个标准，目前没有建议整理的收藏。`;
    moveDustButton.disabled = true;
    return;
  }

  analysisEmpty.hidden = true;
  analysisSummary.textContent = `找到 ${bookmarkCandidates.length} 个收藏，符合“在收藏里超过 ${inactiveDays} 天没打开”或“还没记录到打开时间”的条件。`;
  moveDustButton.disabled = false;

  for (const item of bookmarkCandidates) {
    const fragment = analysisItemTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".analysis-title");
    const url = fragment.querySelector(".analysis-url");
    const meta = fragment.querySelector(".analysis-meta");
    const tag = fragment.querySelector(".analysis-tag");
    const deleteButton = fragment.querySelector(".delete-analysis-btn");

    title.textContent = item.title || "未命名收藏";
    url.textContent = item.url;
    tag.textContent = item.reasonLabel;
    meta.textContent = item.lastVisitText;
    deleteButton.addEventListener("click", () => {
      handleDeleteBookmarkCandidate(item.id).catch((error) => {
        console.error(error);
        showMessage("删除整理建议失败了，请再试一次。", true);
      });
    });

    analysisList.appendChild(fragment);
  }
}

function renderFlipLoadingState() {
  flipList.innerHTML = "";
  flipSummary.textContent = "";
  flipEmpty.hidden = false;
  flipEmpty.textContent = "正在分析高频网址，请稍等...";
  saveFlipButton.disabled = true;
}

function renderFlipAnalysis(historyDays, minVisits) {
  flipList.innerHTML = "";
  flipEmpty.textContent = "这里会自动列出值得补收藏的网址。";

  if (frequentHistoryCandidates.length === 0) {
    flipEmpty.hidden = false;
    flipEmpty.textContent = "按当前条件，没有发现值得补收藏的网址。";
    flipSummary.textContent = `按“最近 ${historyDays} 天至少出现 ${minVisits} 次，而且已经收藏过的网站整站跳过”这个标准，目前没有建议补收藏的网址。`;
    saveFlipButton.disabled = true;
    return;
  }

  flipEmpty.hidden = true;
  const selectedCount = frequentHistoryCandidates.filter((item) => item.selected).length;
  flipSummary.textContent = `找到 ${frequentHistoryCandidates.length} 个网址，最近 ${historyDays} 天里至少出现 ${minVisits} 次，而且所属网站还没被收藏。结果已经按域名去重，已勾选 ${selectedCount} 个。`;
  saveFlipButton.disabled = selectedCount === 0;

  for (const item of frequentHistoryCandidates) {
    const fragment = flipItemTemplate.content.cloneNode(true);
    const checkbox = fragment.querySelector(".flip-checkbox");
    const title = fragment.querySelector(".analysis-title");
    const url = fragment.querySelector(".analysis-url");
    const meta = fragment.querySelector(".analysis-meta");
    const tag = fragment.querySelector(".analysis-tag");
    const deleteButton = fragment.querySelector(".delete-analysis-btn");

    checkbox.checked = item.selected;
    checkbox.addEventListener("change", () => {
      item.selected = checkbox.checked;
      updateFlipActionState(historyDays, minVisits);
    });
    title.textContent = item.title || "未命名网页";
    url.textContent = item.url;
    tag.textContent = "值得翻牌";
    meta.textContent = `最近 ${historyDays} 天访问了 ${item.visitCount} 次，最近一次打开：${formatDate(item.lastVisitTime)}`;
    deleteButton.addEventListener("click", () => {
      handleDeleteHistoryCandidate(item.url).catch((error) => {
        console.error(error);
        showMessage("删除翻牌建议失败了，请再试一次。", true);
      });
    });

    flipList.appendChild(fragment);
  }
}

async function handleDeleteBookmarkCandidate(bookmarkId) {
  const targetItem = bookmarkCandidates.find((item) => item.id === bookmarkId);

  if (!targetItem) {
    showMessage("没找到这条收藏。", true);
    return;
  }

  const confirmed = window.confirm(
    `确认删除这条整理建议吗？\n\n${targetItem.title || targetItem.url}\n\n这次只会从当前建议列表移除，不会删掉浏览器里的收藏。`
  );

  if (!confirmed) {
    return;
  }

  const removedIndex = bookmarkCandidates.findIndex((item) => item.id === bookmarkId);
  const removedItem = { ...targetItem };
  bookmarkCandidates = bookmarkCandidates.filter((item) => item.id !== bookmarkId);
  renderAnalysis(Number.parseInt(inactiveDaysInput.value, 10));
  showMessage(`已经从整理建议里移除“${targetItem.title || targetItem.url}”。`);
  startUndoAction({
    text: "刚刚删除了 1 条收藏整理建议",
    async undo() {
      bookmarkCandidates.splice(removedIndex, 0, removedItem);
      renderAnalysis(Number.parseInt(inactiveDaysInput.value, 10));
      return "已经撤销，这条收藏整理建议回来了。";
    }
  });
}

async function handleDeleteHistoryCandidate(url) {
  const targetItem = frequentHistoryCandidates.find((item) => item.url === url);

  if (!targetItem) {
    showMessage("没找到这条历史记录。", true);
    return;
  }

  const confirmed = window.confirm(
    `确认删除这条翻牌建议吗？\n\n${targetItem.title || targetItem.url}\n\n这次只会从当前建议列表移除，不会删掉浏览器里的历史记录。`
  );

  if (!confirmed) {
    return;
  }

  const removedIndex = frequentHistoryCandidates.findIndex((item) => item.url === url);
  const removedItem = { ...targetItem };
  frequentHistoryCandidates = frequentHistoryCandidates.filter((item) => item.url !== url);

  renderFlipAnalysis(
    Number.parseInt(historyDaysInput.value, 10),
    Number.parseInt(minVisitsInput.value, 10)
  );
  showMessage(`已经从翻牌建议里移除“${targetItem.title || targetItem.url}”。`);
  startUndoAction({
    text: "刚刚删除了 1 条翻牌建议",
    async undo() {
      frequentHistoryCandidates.splice(removedIndex, 0, removedItem);
      renderFlipAnalysis(
        Number.parseInt(historyDaysInput.value, 10),
        Number.parseInt(minVisitsInput.value, 10)
      );
      return "已经撤销，这条翻牌建议回来了。";
    }
  });
}

async function findInactiveBookmarks(inactiveDays) {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkNodes(tree, bookmarks);
  const domainLastVisitMap = await getDomainLastVisitMap(bookmarks);

  const thresholdTime = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;
  const candidates = [];

  for (const bookmark of bookmarks) {
    if (!bookmark.url || bookmark.inDustFolder || isSpecialBookmarkFolder(bookmark)) {
      continue;
    }

    const domainKey = normalizeDomainKey(bookmark.url);
    const lastVisitTime = (domainKey && domainLastVisitMap.get(domainKey)) || bookmark.dateLastUsed || 0;

    if (lastVisitTime === 0 || lastVisitTime < thresholdTime) {
      candidates.push({
        id: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        lastVisitTime,
        reasonLabel: lastVisitTime === 0 ? "没记录到打开时间" : "很久没打开",
        lastVisitText: lastVisitTime === 0
          ? formatBookmarkUnusedText(bookmark.dateAdded)
          : `上次打开时间：${formatDate(lastVisitTime)}`
      });
    }
  }

  candidates.sort((a, b) => a.lastVisitTime - b.lastVisitTime);
  return candidates;
}

function formatBookmarkUnusedText(dateAdded) {
  if (dateAdded) {
    return `还没记录到打开时间，加入收藏时间：${formatDate(dateAdded)}`;
  }

  return "还没记录到打开时间";
}

async function getDomainLastVisitMap(bookmarks) {
  const domainKeys = [...new Set(
    bookmarks
      .filter((bookmark) => bookmark.url)
      .map((bookmark) => normalizeDomainKey(bookmark.url))
      .filter(Boolean)
  )];
  const lastVisitMap = new Map();

  await Promise.all(domainKeys.map(async (domainKey) => {
    const historyItems = await chrome.history.search({
      text: domainKey,
      startTime: 0,
      maxResults: 50
    });

    const matchedItem = historyItems.find((item) => normalizeDomainKey(item.url) === domainKey);
    if (matchedItem?.lastVisitTime) {
      lastVisitMap.set(domainKey, matchedItem.lastVisitTime);
    }
  }));

  return lastVisitMap;
}

async function findFrequentHistoryItems(historyDays, minVisits) {
  const startTime = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const historyItems = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 1000
  });

  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkNodes(tree, bookmarks);
  const bookmarkedUrls = new Set(
    bookmarks
      .filter((bookmark) => bookmark.url)
      .map((bookmark) => normalizeComparableUrl(bookmark.url))
      .filter(Boolean)
  );
  const bookmarkedDomains = new Set(
    bookmarks
      .filter((bookmark) => bookmark.url)
      .map((bookmark) => normalizeDomainKey(bookmark.url))
      .filter(Boolean)
  );

  const candidates = historyItems
    .filter((item) => item.url && /^https?:\/\//i.test(item.url))
    .map((item) => ({
      title: item.title,
      url: item.url,
      normalizedUrl: normalizeComparableUrl(item.url),
      domainKey: normalizeDomainKey(item.url),
      visitCount: item.visitCount || 0,
      lastVisitTime: item.lastVisitTime || 0
    }))
    .filter((item) => item.normalizedUrl && item.domainKey)
    .filter((item) => !isLocalTestUrl(item.url))
    .filter((item) => !isPureIpUrl(item.url))
    .filter((item) => item.visitCount >= minVisits)
    .filter((item) => !bookmarkedUrls.has(item.normalizedUrl))
    .filter((item) => !bookmarkedDomains.has(item.domainKey))
    .map((item) => ({
      ...item,
      selected: false
    }));

  candidates.sort((a, b) => {
    if (b.visitCount !== a.visitCount) {
      return b.visitCount - a.visitCount;
    }

    return b.lastVisitTime - a.lastVisitTime;
  });

  return dedupeByDomain(candidates);
}

function collectBookmarkNodes(nodes, output, insideDustFolder = false, path = []) {
  for (const node of nodes) {
    const currentPath = node.title ? [...path, node.title] : path;
    const nextInsideDustFolder = insideDustFolder || node.title === "吃灰";

    if (node.url) {
      output.push({
        ...node,
        inDustFolder: nextInsideDustFolder,
        folderLabel: path.filter(Boolean).join(" / ")
      });
      continue;
    }

    if (Array.isArray(node.children)) {
      collectBookmarkNodes(node.children, output, nextInsideDustFolder, currentPath);
    }
  }
}

function isSpecialBookmarkFolder(bookmark) {
  return bookmark.url.startsWith("javascript:");
}

async function ensureDustFolder() {
  return ensureNamedFolder("吃灰");
}

async function ensureTargetBookmarkFolder() {
  const folderId = flipFolderSelect.value;

  if (folderId === "__flip__") {
    const createdFolderId = await ensureNamedFolder("翻牌");
    flipFolderSelect.value = createdFolderId;
    return createdFolderId;
  }

  if (folderId) {
    return folderId;
  }

  return ensureNamedFolder("翻牌");
}

async function ensureNamedFolder(folderName, parentId = "__default__") {
  const parentFolderId = await resolveBookmarkParentId(parentId);
  const children = await chrome.bookmarks.getChildren(parentFolderId);
  const existingFolder = children.find((child) => !child.url && child.title === folderName);

  if (existingFolder) {
    return existingFolder.id;
  }

  const created = await chrome.bookmarks.create({
    parentId: parentFolderId,
    title: folderName
  });

  return created.id;
}

async function resolveBookmarkParentId(parentId = "__default__") {
  if (parentId && parentId !== "__default__") {
    return parentId;
  }

  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  return pickDustParentFolder(root).id;
}

function pickDustParentFolder(rootNode) {
  const rootFolders = rootNode.children || [];
  const otherBookmarks = rootFolders.find((node) => node.id === "2");
  const bookmarksBar = rootFolders.find((node) => node.id === "1");

  return otherBookmarks || bookmarksBar || rootFolders[0] || rootNode;
}

function normalizeUrl(input) {
  try {
    const withProtocol = /^(https?:\/\/|chrome:\/\/)/i.test(input) ? input : `https://${input}`;
    return new URL(withProtocol).toString();
  } catch (error) {
    return null;
  }
}

function normalizeComparableUrl(input) {
  try {
    const url = new URL(input);
    url.hash = "";

    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }

    if (url.pathname.endsWith("/") && url.pathname !== "/") {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch (error) {
    return null;
  }
}

function normalizeDomainKey(input) {
  try {
    const { hostname } = new URL(input);
    return getMainDomain(hostname);
  } catch (error) {
    return null;
  }
}

function getMainDomain(hostname) {
  const normalizedHostname = hostname.replace(/^www\./i, "").toLowerCase();

  if (!normalizedHostname || normalizedHostname === "localhost" || normalizedHostname.includes(":")) {
    return normalizedHostname;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHostname)) {
    return normalizedHostname;
  }

  const parts = normalizedHostname.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return normalizedHostname;
  }

  const multiPartSuffixes = new Set([
    "ac.cn",
    "co.jp",
    "co.kr",
    "co.nz",
    "co.uk",
    "com.au",
    "com.cn",
    "com.hk",
    "com.mx",
    "com.sg",
    "com.tr",
    "edu.cn",
    "gov.cn",
    "net.cn",
    "net.au",
    "org.cn",
    "org.uk"
  ]);
  const suffix = parts.slice(-2).join(".");

  if (multiPartSuffixes.has(suffix) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function dedupeByDomain(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (seen.has(item.domainKey)) {
      continue;
    }

    seen.add(item.domainKey);
    result.push(item);
  }

  return result;
}

async function renderBookmarkFolderOptions() {
  const previousValue = flipFolderSelect.value;
  const folderOptions = await getBookmarkFolderOptions();
  flipFolderSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "__flip__";
  defaultOption.textContent = "翻牌（自动创建）";
  flipFolderSelect.appendChild(defaultOption);

  for (const folder of folderOptions) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.label || "未命名收藏夹";
    flipFolderSelect.appendChild(option);
  }

  if (folderOptions.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "暂时没有找到可选收藏夹";
    flipFolderSelect.appendChild(emptyOption);
  }

  const hasPrevious = [...flipFolderSelect.options].some((option) => option.value === previousValue);
  flipFolderSelect.value = hasPrevious ? previousValue : "__flip__";
}

async function getBookmarkFolderOptions() {
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  collectBookmarkFolders(tree, folders);
  return folders;
}

async function getSearchableBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkNodes(tree, bookmarks);

  return bookmarks
    .filter((bookmark) => bookmark.url && /^https?:\/\//i.test(bookmark.url))
    .filter((bookmark) => !bookmark.inDustFolder)
    .filter((bookmark) => !isSpecialBookmarkFolder(bookmark))
    .map((bookmark) => ({
      title: bookmark.title || "",
      url: bookmark.url,
      normalizedUrl: normalizeComparableUrl(bookmark.url),
      domainLabel: normalizeDomainKey(bookmark.url) || "网站",
      folderLabel: bookmark.folderLabel || "",
      searchText: [
        bookmark.title || "",
        bookmark.url || "",
        normalizeDomainKey(bookmark.url) || "",
        bookmark.folderLabel || ""
      ].join(" ").toLowerCase()
    }));
}

async function getRecentlyClosedTabs(limit = 20) {
  const sessions = await chrome.sessions.getRecentlyClosed({
    maxResults: 25
  });

  const recentTabs = sessions
    .flatMap((session) => getTabsFromClosedSession(session).map((tab) => ({
      sessionId: tab.sessionId || "",
      dismissKey: buildRecentTabDismissKey(tab, session.lastModified || 0),
      title: tab.title || "",
      url: tab.url || "",
      domainLabel: normalizeDomainKey(tab.url || "") || "网站",
      closedAt: session.lastModified || 0,
      searchText: [tab.title || "", tab.url || "", normalizeDomainKey(tab.url || "") || ""].join(" ").toLowerCase()
    })))
    .filter((item) => item.url && /^https?:\/\//i.test(item.url));

  recentTabs.sort((a, b) => {
    if (a.closedAt !== b.closedAt) {
      return a.closedAt - b.closedAt;
    }

    const textA = (a.title || a.domainLabel || "").toLowerCase();
    const textB = (b.title || b.domainLabel || "").toLowerCase();
      return textA.localeCompare(textB, "zh-CN");
    });

  const availableKeys = new Set(recentTabs.map((item) => item.dismissKey));
  pruneRecentTabDismissals(availableKeys);
  return recentTabs.filter((item) => !dismissedRecentTabKeys.has(item.dismissKey)).slice(0, limit);
}

function findRecentClosedTabMatches(keyword) {
  const normalizedKeyword = (keyword || "").trim().toLowerCase();

  if (!normalizedKeyword) {
    return recentClosedTabs;
  }

  return recentClosedTabs.filter((item) => item.searchText.includes(normalizedKeyword));
}

function getTabsFromClosedSession(session) {
  if (session?.tab) {
    return [session.tab];
  }

  if (Array.isArray(session?.window?.tabs)) {
    return session.window.tabs;
  }

  return [];
}

function buildRecentTabDismissKey(tab, closedAt = 0) {
  const sessionId = tab?.sessionId || "";
  const normalizedUrl = normalizeComparableUrl(tab?.url || "") || tab?.url || "";
  const title = tab?.title || "";

  if (sessionId) {
    return `session:${sessionId}`;
  }

  return `tab:${closedAt}:${normalizedUrl}:${title}`;
}

async function getFolderBookmarkGroups() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkNodes(tree, bookmarks);

  const groupedMap = new Map();

  for (const bookmark of bookmarks) {
    if (!bookmark.url || !/^https?:\/\//i.test(bookmark.url)) {
      continue;
    }

    if (bookmark.inDustFolder || isSpecialBookmarkFolder(bookmark)) {
      continue;
    }

    const groupLabel = bookmark.folderLabel || "未分组";
    if (!groupedMap.has(groupLabel)) {
      groupedMap.set(groupLabel, []);
    }

    groupedMap.get(groupLabel).push({
      title: bookmark.title || "",
      url: bookmark.url,
      domainLabel: normalizeDomainKey(bookmark.url) || "网站"
    });
  }

  const groups = [...groupedMap.entries()]
    .map(([label, items]) => ({
      label,
      groupTitle: extractPrimaryFolderGroupName(label) || label || "收藏夹",
      items: items.sort((a, b) => {
        const textA = (a.title || a.domainLabel || "").toLowerCase();
        const textB = (b.title || b.domainLabel || "").toLowerCase();
        return textA.localeCompare(textB, "zh-CN");
      })
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));

  return groups;
}

function findBookmarkMatches(keyword, limit = 6) {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword) {
    return [];
  }

  return searchableBookmarks
    .map((item) => ({
      ...item,
      score: getBookmarkMatchScore(item, normalizedKeyword)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function getBookmarkMatchScore(item, keyword) {
  const title = (item.title || "").toLowerCase();
  const url = (item.url || "").toLowerCase();
  const domain = (item.domainLabel || "").toLowerCase();
  const folder = (item.folderLabel || "").toLowerCase();

  if (url === keyword || domain === keyword) {
    return 120;
  }

  if (url.includes(keyword) || domain.includes(keyword)) {
    return 90;
  }

  if (title.includes(keyword)) {
    return 70;
  }

  if (folder.includes(keyword)) {
    return 50;
  }

  if (item.searchText.includes(keyword)) {
    return 30;
  }

  return 0;
}

async function openBookmarkUrl(url) {
  await chrome.tabs.create({
    url,
    active: true
  });
}

function getQuickOpenKeyword() {
  return quickOpenInput ? quickOpenInput.value : "";
}

function getRecentTabKeyword() {
  return recentTabSearchInput ? recentTabSearchInput.value : "";
}

function buildGoogleSearchUrl(keyword) {
  return `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
}

function isLikelyUrlInput(input) {
  const text = (input || "").trim();
  if (!text || /\s/.test(text)) {
    return false;
  }

  if (/^(https?:\/\/|chrome:\/\/)/i.test(text)) {
    return true;
  }

  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(text);
}

async function getShortcutCandidates() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkNodes(tree, bookmarks);
  const usageMap = await getBookmarkUsageMap();

  const shortcuts = bookmarks
    .filter((bookmark) => bookmark.url && /^https?:\/\//i.test(bookmark.url))
    .filter((bookmark) => !bookmark.inDustFolder)
    .filter((bookmark) => !isSpecialBookmarkFolder(bookmark))
    .map((bookmark) => {
      const normalizedUrl = normalizeComparableUrl(bookmark.url);
      const domainKey = normalizeDomainKey(bookmark.url) || normalizedUrl || bookmark.url;
      const usage = normalizedUrl ? usageMap.get(normalizedUrl) : null;
      return {
        title: bookmark.title || domainKey,
        shortLabel: buildShortcutLabel(bookmark.title || domainKey),
        domainLabel: domainKey,
        domainKey,
        folderLabel: bookmark.folderLabel || "",
        url: bookmark.url,
        visitCount: usage?.visitCount || 0,
        lastVisitTime: usage?.lastVisitTime || bookmark.dateLastUsed || 0,
        dateAdded: bookmark.dateAdded || 0
      };
    });

  shortcuts.sort(compareBaseShortcutScore);

  const uniqueShortcuts = [];
  const seenDomains = new Set();

  for (const item of shortcuts) {
    if (seenDomains.has(item.domainKey)) {
      continue;
    }

    seenDomains.add(item.domainKey);
    uniqueShortcuts.push(item);
  }

  pruneShortcutPreferences(seenDomains);
  return uniqueShortcuts;
}

function getTopBookmarkShortcuts(shortcuts, limit = 16) {
  return shortcuts
    .map(prepareShortcutForDisplay)
    .filter((item) => !item.isCleared || item.isPinned)
    .sort(comparePreparedShortcutScore)
    .slice(0, limit);
}

function compareBaseShortcutScore(a, b) {
  if (b.visitCount !== a.visitCount) {
    return b.visitCount - a.visitCount;
  }

  if (b.lastVisitTime !== a.lastVisitTime) {
    return b.lastVisitTime - a.lastVisitTime;
  }

  return b.dateAdded - a.dateAdded;
}

function prepareShortcutForDisplay(item) {
  const hasClearedBaseline = Object.prototype.hasOwnProperty.call(
    shortcutPreferences.cleared,
    item.domainKey
  );
  const clearedBaseVisitCount = hasClearedBaseline ? shortcutPreferences.cleared[item.domainKey] : 0;
  const adjustedVisitCount = Math.max(0, item.visitCount - clearedBaseVisitCount);
  const isPinned = Boolean(shortcutPreferences.pinned[item.domainKey]);
  const orderIndex = shortcutPreferences.order.indexOf(item.domainKey);
  const adjustedLastVisitTime =
    hasClearedBaseline && adjustedVisitCount === 0 ? 0 : item.lastVisitTime;

  return {
    ...item,
    isPinned,
    isCleared: hasClearedBaseline && adjustedVisitCount === 0,
    orderIndex,
    rawVisitCount: item.visitCount,
    adjustedVisitCount,
    adjustedLastVisitTime
  };
}

function comparePreparedShortcutScore(a, b) {
  if (a.isPinned !== b.isPinned) {
    return Number(b.isPinned) - Number(a.isPinned);
  }

  const aHasManualOrder = a.orderIndex >= 0;
  const bHasManualOrder = b.orderIndex >= 0;
  if (aHasManualOrder !== bHasManualOrder) {
    return Number(bHasManualOrder) - Number(aHasManualOrder);
  }

  if (aHasManualOrder && bHasManualOrder && a.orderIndex !== b.orderIndex) {
    return a.orderIndex - b.orderIndex;
  }

  if (b.adjustedVisitCount !== a.adjustedVisitCount) {
    return b.adjustedVisitCount - a.adjustedVisitCount;
  }

  if (b.adjustedLastVisitTime !== a.adjustedLastVisitTime) {
    return b.adjustedLastVisitTime - a.adjustedLastVisitTime;
  }

  return compareBaseShortcutScore(a, b);
}

function loadShortcutPreferences() {
  try {
    const rawValue = window.localStorage.getItem(SHORTCUT_PREFERENCES_KEY);
    if (!rawValue) {
      return createDefaultShortcutPreferences();
    }

    return normalizeShortcutPreferences(JSON.parse(rawValue));
  } catch (error) {
    return createDefaultShortcutPreferences();
  }
}

function createDefaultShortcutPreferences() {
  return {
    pinned: {},
    cleared: {},
    order: []
  };
}

function normalizeShortcutPreferences(rawValue = {}) {
  const defaultValue = createDefaultShortcutPreferences();
  const pinned = {};
  const cleared = {};

  if (rawValue?.pinned && typeof rawValue.pinned === "object") {
    for (const [key, value] of Object.entries(rawValue.pinned)) {
      if (value && key) {
        pinned[key] = true;
      }
    }
  }

  if (rawValue?.cleared && typeof rawValue.cleared === "object") {
    for (const [key, value] of Object.entries(rawValue.cleared)) {
      const nextValue = Number(value);
      if (key && Number.isFinite(nextValue) && nextValue >= 0) {
        cleared[key] = nextValue;
      }
    }
  }

  const order = Array.isArray(rawValue?.order)
    ? [...new Set(rawValue.order.filter((item) => typeof item === "string" && item))]
    : defaultValue.order;

  return {
    pinned,
    cleared,
    order
  };
}

function saveShortcutPreferences() {
  window.localStorage.setItem(SHORTCUT_PREFERENCES_KEY, JSON.stringify(shortcutPreferences));
}

function cloneShortcutPreferences(value) {
  return normalizeShortcutPreferences(JSON.parse(JSON.stringify(value)));
}

function restoreShortcutPreferences(snapshot) {
  shortcutPreferences = normalizeShortcutPreferences(snapshot);
  saveShortcutPreferences();
  topShortcuts = getTopBookmarkShortcuts(shortcutCandidates);
  renderShortcuts();
}

function applyShortcutManualOrder(visibleKeys) {
  const visibleKeySet = new Set(visibleKeys);
  const remainingKeys = shortcutPreferences.order.filter((key) => !visibleKeySet.has(key));
  shortcutPreferences.order = [...new Set([...visibleKeys, ...remainingKeys])];
  saveShortcutPreferences();
}

function pruneShortcutPreferences(availableKeys) {
  const nextPinned = {};
  const nextCleared = {};

  for (const key of Object.keys(shortcutPreferences.pinned)) {
    if (availableKeys.has(key)) {
      nextPinned[key] = true;
    }
  }

  for (const [key, value] of Object.entries(shortcutPreferences.cleared)) {
    if (availableKeys.has(key)) {
      nextCleared[key] = value;
    }
  }

  const nextOrder = shortcutPreferences.order.filter((key) => availableKeys.has(key));
  const hasChanged =
    JSON.stringify(nextPinned) !== JSON.stringify(shortcutPreferences.pinned) ||
    JSON.stringify(nextCleared) !== JSON.stringify(shortcutPreferences.cleared) ||
    JSON.stringify(nextOrder) !== JSON.stringify(shortcutPreferences.order);

  if (!hasChanged) {
    return;
  }

  shortcutPreferences = {
    pinned: nextPinned,
    cleared: nextCleared,
    order: nextOrder
  };
  saveShortcutPreferences();
}

function loadRecentTabDismissals() {
  try {
    const rawValue = window.localStorage.getItem(RECENT_TAB_DISMISSALS_KEY);
    if (!rawValue) {
      return new Set();
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return new Set();
    }

    return new Set(parsedValue.filter((item) => typeof item === "string" && item));
  } catch (error) {
    return new Set();
  }
}

function saveRecentTabDismissals() {
  window.localStorage.setItem(
    RECENT_TAB_DISMISSALS_KEY,
    JSON.stringify([...dismissedRecentTabKeys])
  );
}

function pruneRecentTabDismissals(availableKeys) {
  const nextDismissals = new Set(
    [...dismissedRecentTabKeys].filter((dismissKey) => availableKeys.has(dismissKey))
  );

  const currentList = [...dismissedRecentTabKeys].sort();
  const nextList = [...nextDismissals].sort();
  if (JSON.stringify(currentList) === JSON.stringify(nextList)) {
    return;
  }

  dismissedRecentTabKeys = nextDismissals;
  saveRecentTabDismissals();
}

async function getBookmarkUsageMap() {
  const historyItems = await chrome.history.search({
    text: "",
    startTime: 0,
    maxResults: 5000
  });

  const usageMap = new Map();

  for (const item of historyItems) {
    if (!item.url || !/^https?:\/\//i.test(item.url)) {
      continue;
    }

    const normalizedUrl = normalizeComparableUrl(item.url);
    if (!normalizedUrl) {
      continue;
    }

    const currentUsage = usageMap.get(normalizedUrl);
    const nextVisitCount = item.visitCount || 0;
    const nextLastVisitTime = item.lastVisitTime || 0;

    if (!currentUsage) {
      usageMap.set(normalizedUrl, {
        visitCount: nextVisitCount,
        lastVisitTime: nextLastVisitTime
      });
      continue;
    }

    usageMap.set(normalizedUrl, {
      visitCount: Math.max(currentUsage.visitCount, nextVisitCount),
      lastVisitTime: Math.max(currentUsage.lastVisitTime, nextLastVisitTime)
    });
  }

  return usageMap;
}

function collectBookmarkFolders(nodes, output, path = []) {
  for (const node of nodes) {
    if (node.url) {
      continue;
    }

    const currentPath = node.title ? [...path, node.title] : path;

    if (node.id !== "0" && node.title) {
      output.push({
        id: node.id,
        label: currentPath.join(" / ")
      });
    }

    if (Array.isArray(node.children)) {
      collectBookmarkFolders(node.children, output, currentPath);
    }
  }
}

function updateFlipActionState(historyDays, minVisits) {
  const selectedCount = frequentHistoryCandidates.filter((item) => item.selected).length;
  flipSummary.textContent = `找到 ${frequentHistoryCandidates.length} 个网址，最近 ${historyDays} 天里至少出现 ${minVisits} 次，而且所属网站还没被收藏。已勾选 ${selectedCount} 个。`;
  saveFlipButton.disabled = selectedCount === 0;
}

function isPureIpUrl(input) {
  try {
    const { hostname } = new URL(input);

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      return hostname.split(".").every((part) => {
        const value = Number.parseInt(part, 10);
        return value >= 0 && value <= 255;
      });
    }

    return /^\[[0-9a-f:]+\]$/i.test(hostname);
  } catch (error) {
    return false;
  }
}

function isLocalTestUrl(input) {
  try {
    const { hostname } = new URL(input);
    const normalizedHostname = hostname.toLowerCase();

    if (normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost")) {
      return true;
    }

    if (normalizedHostname === "::1" || normalizedHostname === "[::1]") {
      return true;
    }

    return /^127(\.\d{1,3}){3}$/.test(normalizedHostname);
  } catch (error) {
    return false;
  }
}

function buildShortcutLabel(text) {
  const normalizedText = (text || "网站").trim();
  return normalizedText.length > 8 ? `${normalizedText.slice(0, 8)}...` : normalizedText;
}

function setupShortcutIcon(iconElement, fallbackElement, url, label) {
  const siteIconUrl = getSiteIconUrl(url);
  const browserIconUrl = getFaviconUrl(url);
  const fallbackText = getShortcutFallbackText(label);

  iconElement.dataset.siteIconUrl = siteIconUrl;
  iconElement.dataset.browserIconUrl = browserIconUrl;
  iconElement.dataset.iconFallback = "site";
  iconElement.classList.remove("is-hidden");
  fallbackElement.textContent = fallbackText;
  fallbackElement.classList.remove("is-visible");

  iconElement.onerror = () => {
    if (iconElement.dataset.iconFallback === "site") {
      iconElement.dataset.iconFallback = "browser";
      iconElement.src = browserIconUrl;
      return;
    }

    iconElement.onerror = null;
    iconElement.removeAttribute("src");
    iconElement.classList.add("is-hidden");
    fallbackElement.classList.add("is-visible");
  };

  iconElement.src = siteIconUrl;
}

function getShortcutFallbackText(text) {
  const normalizedText = (text || "网").trim();
  const firstChar = normalizedText.charAt(0);
  return firstChar || "网";
}

function getSiteIconUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}/favicon.ico`;
  } catch (error) {
    return getFaviconUrl(url);
  }
}

function getFaviconUrl(url) {
  const faviconPath = `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
  return chrome.runtime.getURL(faviconPath);
}

function showMessage(text, isError = false) {
  if (!message) {
    return;
  }

  if (!text) {
    hideMessage();
    return;
  }

  const isLoading = shouldKeepMessageVisible(text) && !isError;

  if (isLoading) {
    if (activeLoadingToast) {
      updateMessageToast(activeLoadingToast, text, { isError: false, isLoading: true });
      return;
    }

    activeLoadingToast = createMessageToast(text, { isError: false, isLoading: true });
    return;
  }

  if (activeLoadingToast) {
    removeMessageToast(activeLoadingToast);
    activeLoadingToast = null;
  }

  const duration = isError ? 4000 : 2600;
  const toast = createMessageToast(text, { isError, isLoading: false });
  window.setTimeout(() => {
    removeMessageToast(toast);
  }, duration);
}

function hideMessage() {
  if (!message) {
    return;
  }

  if (activeLoadingToast) {
    removeMessageToast(activeLoadingToast);
    activeLoadingToast = null;
  }

  message.querySelectorAll(".message-toast").forEach((toast) => {
    toast.remove();
  });
}

function shouldKeepMessageVisible(text) {
  const normalizedText = (text || "").trim();
  return /^(正在|请稍等|加载中|刷新中)/.test(normalizedText);
}

function createMessageToast(text, options = {}) {
  const { isError = false, isLoading = false } = options;
  const toast = document.createElement("div");
  toast.className = "message toast message-toast";
  updateMessageToast(toast, text, { isError, isLoading });
  message.appendChild(toast);
  return toast;
}

function updateMessageToast(toast, text, options = {}) {
  const { isError = false, isLoading = false } = options;
  toast.textContent = text;
  toast.classList.toggle("is-error", isError);
  toast.classList.toggle("is-loading", isLoading);
}

function removeMessageToast(toast) {
  if (!(toast instanceof HTMLElement) || !message.contains(toast)) {
    return;
  }

  if (toast === activeLoadingToast) {
    activeLoadingToast = null;
  }

  toast.remove();
}

function startUndoAction(action) {
  clearUndoAction();
  pendingUndoAction = {
    ...action,
    expiresAt: Date.now() + UNDO_WINDOW_MS
  };
  renderUndoToast();
  undoTickTimer = window.setInterval(renderUndoToast, 1000);
  undoExpireTimer = window.setTimeout(() => {
    clearUndoAction();
  }, UNDO_WINDOW_MS);
}

function clearUndoAction(options = {}) {
  const { keepUndoLock = false } = options;
  pendingUndoAction = null;

  if (!keepUndoLock) {
    undoInProgress = false;
  }

  if (undoExpireTimer) {
    window.clearTimeout(undoExpireTimer);
    undoExpireTimer = null;
  }

  if (undoTickTimer) {
    window.clearInterval(undoTickTimer);
    undoTickTimer = null;
  }

  renderUndoToast();
}

function renderUndoToast() {
  if (!message) {
    return;
  }

  if (!pendingUndoAction) {
    removeUndoToast();
    return;
  }

  const remainingMs = Math.max(0, pendingUndoAction.expiresAt - Date.now());
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (!activeUndoToast) {
    activeUndoToast = createUndoToast();
  }

  const textElement = activeUndoToast.querySelector(".undo-toast__text");
  const metaElement = activeUndoToast.querySelector(".undo-toast__meta");
  const buttonElement = activeUndoToast.querySelector(".undo-toast__btn");

  if (!textElement || !metaElement || !buttonElement) {
    return;
  }

  textElement.textContent = pendingUndoAction.text;
  metaElement.textContent = `${remainingSeconds} 秒内可撤销`;
  buttonElement.disabled = undoInProgress;
}

async function handleUndoLastAction() {
  if (!pendingUndoAction || undoInProgress) {
    return;
  }

  const currentAction = pendingUndoAction;
  undoInProgress = true;
  renderUndoToast();
  clearUndoAction({ keepUndoLock: true });

  try {
    const messageText = await currentAction.undo();
    showMessage(messageText || "已经撤销上一步。");
  } catch (error) {
    console.error(error);
    showMessage("撤销失败了，请再试一次。", true);
  } finally {
    undoInProgress = false;
  }
}

function createUndoToast() {
  const toast = document.createElement("div");
  toast.className = "undo-toast toast";

  const content = document.createElement("div");
  content.className = "undo-toast__content";

  const text = document.createElement("p");
  text.className = "undo-toast__text";

  const meta = document.createElement("p");
  meta.className = "undo-toast__meta";
  meta.textContent = "10 秒内可撤销";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "undo-toast__btn";
  button.textContent = "↶";
  button.setAttribute("aria-label", "撤销上一步");
  button.title = "撤销上一步";
  button.addEventListener("click", handleUndoLastAction);

  content.append(text, meta);
  toast.append(content, button);
  message.appendChild(toast);
  return toast;
}

function removeUndoToast() {
  if (!(activeUndoToast instanceof HTMLElement)) {
    activeUndoToast = null;
    return;
  }

  activeUndoToast.remove();
  activeUndoToast = null;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(timestamp);
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp);
}
