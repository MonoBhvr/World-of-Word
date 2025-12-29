const firebaseConfig = { apiKey: "AIzaSyB4YI3_w6bXIcxXB7gC7Xnzo9biEKVGSqM", authDomain: "ciaword-a7c51.firebaseapp.com", projectId: "ciaword-a7c51", storageBucket: "ciaword-a7c51.firebasestorage.app", messagingSenderId: "566446687672", appId: "1:566446687672:web:ea63701602a00ac28a7b4d" };
const GEMINI_KEY = "AIzaSyAqyJx7Sg6JWjqAHsKsrVTOJUsD14JlDx0";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ============================================================
// [Global Variables & Settings]
// ============================================================
let allWords = [], currentSession = [], recalledWords = [], currentIdx = 0, curPhase = 'home';
let correctionQueue = [];
let retryQueue = [];
let correctionIdx = 0;
let sessionType = 'normal';
let dailyStatus = { finished: false, date: "" };
let correctionTarget = null;

// ★ 통합된 설정 객체 (CONFIG 제거됨)
let userSettings = JSON.parse(localStorage.getItem('wow_settings')) || {
    previewTime: 2.0,
    reLearnTime: 3.0,
    dailyGoal: 20
};

// ============================================================
// [Auth & Init]
// ============================================================
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('page-auth').style.display='none';
        document.getElementById('mainArea').style.display='flex';
        loadData();
    } else {
        document.getElementById('page-auth').style.display='flex';
        document.getElementById('mainArea').style.display='none';
    }
});

// 페이지 로드 시 설정값 UI에 반영
document.addEventListener('DOMContentLoaded', () => {
    updateSettingUI();
    // 스트릭 설정 로드
    changePeriod(currentPeriod);
});

function login() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(e => myAlert("로그인 실패: " + e.message));
}
function logout() {
    auth.signOut();
    location.reload();
}
function myAlert(msg) {
    const el = document.getElementById('customAlert');
    document.getElementById('alertMsg').innerText = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

// ============================================================
// [Settings Logic] 설정 관련 함수 통합
// ============================================================
function toggleSettings() {
    document.getElementById('settingsOverlay').classList.toggle('open');
}
// [Settings Logic] DB에서 설정 불러오기
async function loadSettings() {
    if (!auth.currentUser) return;

    const docRef = db.collection('users').doc(auth.currentUser.uid).collection('meta').doc('settings');
    const doc = await docRef.get();

    if (doc.exists) {
        // DB에 저장된 설정이 있으면 덮어쓰기
        const data = doc.data();
        // 기존 키값 유지하면서 병합 (새로운 설정 항목이 생길 경우 대비)
        userSettings = { ...userSettings, ...data };
    } else {
        // DB에 설정 문서가 없으면 기본값으로 생성
        await docRef.set(userSettings);
    }

    // UI에 반영
    updateSettingsUI();
}

function updateSettingUI() {
    // 시간 설정 UI 반영
    if(document.getElementById('previewTimeVal'))
        document.getElementById('previewTimeVal').innerText = userSettings.previewTime.toFixed(1) + 's';
    if(document.getElementById('reLearnTimeVal'))
        document.getElementById('reLearnTimeVal').innerText = userSettings.reLearnTime.toFixed(1) + 's';

    // 하루 학습량 UI 반영
    if(document.getElementById('dailyGoalVal'))
        document.getElementById('dailyGoalVal').innerText = userSettings.dailyGoal;
}

// [Settings Logic] 설정값 변경 및 DB 저장
async function adjSetting(key, val) {
    let current = userSettings[key];
    let newVal = current + val;

    // --- 값 제한 로직 ---
    if (key === 'previewTime') {
        if (newVal < 0.5) newVal = 0.5;
        if (newVal > 5.0) newVal = 5.0;
    }
    else if (key === 'reLearnTime') {
        if (newVal < 1.0) newVal = 0.5;
        if (newVal > 10.0) newVal = 10.0;
    }
    else if (key === 'dailyGoal') {
        if (newVal < 5) newVal = 5;
        if (newVal > 100) newVal = 100;
    }

    // 소수점 오차 보정 (부동소수점 문제 방지)
    if (key !== 'dailyGoal') {
        newVal = Math.round(newVal * 10) / 10;
    }

    // 전역 변수 업데이트
    userSettings[key] = newVal;

    // UI 즉시 업데이트
    updateSettingsUI();

    // ★ DB 비동기 저장 (사용자 경험을 위해 await 없이 백그라운드 저장)
    if (auth.currentUser) {
        db.collection('users').doc(auth.currentUser.uid).collection('meta').doc('settings')
            .set(userSettings, { merge: true })
            .catch(err => console.error("설정 저장 실패:", err));
    }
}

// ============================================================
// [Data & Dashboard]
// ============================================================
async function loadData() {
    try {
        const snap = await db.collection('users').doc(auth.currentUser.uid).collection('words').get();
        allWords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const todayStr = new Date().toDateString();
        const metaRef = db.collection('users').doc(auth.currentUser.uid).collection('meta').doc('daily');
        const metaDoc = await metaRef.get();

        if (metaDoc.exists && metaDoc.data().date === todayStr) {
            dailyStatus = metaDoc.data();
        } else {
            dailyStatus = { finished: false, date: todayStr, wordIds: [] };
        }
        await loadSettings();
        renderDashboard();
        renderStreak();
        renderAccordion();
        showPage('home');
        checkResume();
    } catch (e) {
        console.error("Load Error:", e);
        myAlert("데이터 로딩 중 오류가 발생했습니다.");
    }
}

function renderDashboard() {
    if (typeof allWords === 'undefined') return;

    const now = Date.now();

    // 1. 복습 카운트
    const reviewCount = allWords.filter(w =>
        w.lastStudied &&
        w.nextReview &&
        w.nextReview <= now
    ).length;
    document.getElementById('countReview').innerText = reviewCount;

    // 2. 오늘의 신규 학습
    const unstudiedWords = allWords.filter(w => !w.lastStudied);
    const maxDaily = userSettings.dailyGoal || 20; // 설정값 사용

    // 화면 표시용 (남은 것 vs 목표량 중 작은 것)
    const countToShow = Math.min(unstudiedWords.length, maxDaily);
    const todayCountEl = document.getElementById('countToday');

    if (dailyStatus.finished) {
        todayCountEl.innerText = "완료";
        todayCountEl.style.color = "#00ff88";
    } else {
        todayCountEl.innerText = countToShow;
        todayCountEl.style.color = "var(--text)";
    }

    // 3. 시작 버튼 이벤트
    document.getElementById('todayTask').onclick = async () => {
        if (dailyStatus.finished) {
            // [완료 상태] 추가 학습
            if(allWords.length === 0) return myAlert("단어가 없습니다.");

            const pool = allWords.filter(w => !w.lastStudied || w.lastStudied < new Date().setHours(0,0,0,0));
            const randomList = pool.sort(() => 0.5 - Math.random()).slice(0, maxDaily);
            startFlow(randomList, 'normal');

        } else {
            // [학습 전 상태] 정규 학습
            if (unstudiedWords.length === 0) return myAlert("신규 학습할 단어가 없습니다!");

            // 설정된 개수만큼 잘라서 시작
            const sessionList = unstudiedWords.slice(0, maxDaily);

            // 일일 학습 기록을 위해 sessionType을 'daily'로 넘길 수도 있음 (여기선 로직상 normal 사용하거나 startDailySession 호출)
            // 여기서는 심플하게 잘라서 바로 시작
            startDailySession(sessionList);
        }
    };

    // 복습 버튼
    document.getElementById('reviewTask').onclick = () => {
        const reviews = allWords.filter(w => w.lastStudied && w.nextReview && w.nextReview <= now);
        if(reviews.length === 0) return myAlert("복습할 단어가 없습니다.");

        reviews.sort((a,b) => a.nextReview - b.nextReview);
        // 복습도 너무 많으면 설정값만큼 끊어서 진행
        startFlow(reviews.slice(0, maxDaily), 'review');
    };
}

// 오늘의 단어 세션 시작 (DB 저장/로드 로직 포함)
async function startDailySession(preSelectedList) {
    let targetList = [];

    // 이미 목록이 넘어왔으면 그것 사용 (renderDashboard에서 자른 것)
    if(preSelectedList && preSelectedList.length > 0) {
        targetList = preSelectedList;
    }
    // 아니라면 DB 체크
    else if (dailyStatus.wordIds && dailyStatus.wordIds.length > 0) {
        targetList = allWords.filter(w => dailyStatus.wordIds.includes(w.id));
    }

    if (targetList.length === 0) return myAlert("학습할 단어가 없습니다.");

    // DB에 "이게 오늘의 단어다"라고 저장 (첫 시작일 경우)
    if (!dailyStatus.wordIds || dailyStatus.wordIds.length === 0) {
        const newIds = targetList.map(w => w.id);
        const todayStr = new Date().toDateString();
        try {
            await db.collection('users').doc(auth.currentUser.uid).collection('meta').doc('daily').set({
                date: todayStr,
                wordIds: newIds,
                finished: false
            });
            dailyStatus = { date: todayStr, wordIds: newIds, finished: false };
        } catch(e) { console.log("Meta save failed", e); }
    }

    startFlow(targetList, 'daily');
}

// ============================================================
// [UI & Page Control]
// ============================================================
function showPage(id) {
    curPhase = id;
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const targetId = ['preview', 'dump'].includes(id) ? 'learn' : id;
    document.getElementById('page-' + targetId).style.display = 'block';

    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('active');
        if(b.classList.contains('nav-'+id)) b.classList.add('active');
    });

    document.getElementById('pBarWrap').style.display = 'none';
    clearTimeout(window.pt);
}

// ============================================================
// [Streak Logic]
// ============================================================
let currentPeriod = localStorage.getItem('saved_streak_period') || '1Y';

const periodConfig = {
    '3M': { days: 110, size: '22px' },
    '6M': { days: 180, size: '15px' },
    '1Y': { days: 365, size: '11px' }
};

function changePeriod(period) {
    currentPeriod = period;
    localStorage.setItem('saved_streak_period', period);

    const buttons = document.querySelectorAll('.period-selector button');
    buttons.forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.getElementById(`btn-${period}`);
    if(targetBtn) targetBtn.classList.add('active');

    const root = document.documentElement;
    if(periodConfig[period]) {
        root.style.setProperty('--cell-size', periodConfig[period].size);
    }
    renderStreak();
}

function renderStreak() {
    const grid = document.getElementById('streakGrid');
    if(!grid) return;
    grid.innerHTML = "";

    const history = {};
    if (typeof allWords !== 'undefined') {
        allWords.forEach(w => {
            if(w.lastStudied) {
                const d = new Date(w.lastStudied);
                const offset = d.getTimezoneOffset() * 60000;
                const localDate = new Date(d.getTime() - offset);
                const key = localDate.toISOString().split('T')[0];
                history[key] = (history[key] || 0) + 1;
            }
        });
    }

    const config = periodConfig[currentPeriod] || periodConfig['1Y'];
    const totalDays = config.days;
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - totalDays);

    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);

    const loopDate = new Date(startDate);
    while (loopDate <= today) {
        const offset = loopDate.getTimezoneOffset() * 60000;
        const localDate = new Date(loopDate.getTime() - offset);
        const dateStr = localDate.toISOString().split('T')[0];
        const count = history[dateStr] || 0;

        const el = document.createElement('div');
        el.className = 'day';

        if(count === 0) el.style.backgroundColor = 'var(--gh-empty)';
        else if(count <= 3) el.style.backgroundColor = 'var(--gh-l1)';
        else if(count <= 6) el.style.backgroundColor = 'var(--gh-l2)';
        else if(count <= 10) el.style.backgroundColor = 'var(--gh-l3)';
        else el.style.backgroundColor = 'var(--gh-l4)';

        el.onmousemove = (e) => {
            const tooltip = document.getElementById('streakTooltip');
            if(tooltip) {
                tooltip.innerHTML = `<strong>${dateStr}</strong><br>${count} words`;
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top = (e.clientY + 15) + 'px';
                tooltip.style.opacity = '1';
            }
        };
        el.onmouseleave = () => {
            const tooltip = document.getElementById('streakTooltip');
            if(tooltip) tooltip.style.opacity = '0';
        };
        el.onclick = () => {
            if (typeof openStreakModal === 'function') openStreakModal(dateStr);
        };
        grid.appendChild(el);
        loopDate.setDate(loopDate.getDate() + 1);
    }
    const scrollView = document.querySelector('.streak-scroll-view');
    if(scrollView) {
        setTimeout(() => { scrollView.scrollTo({ left: 9999, behavior: 'smooth' }); }, 50);
        setTimeout(() => { scrollView.scrollLeft = 9999; }, 10);
    }
}

function openStreakModal(dateStr) {
    document.getElementById('wordListModal').style.display = 'flex';
    document.getElementById('modalDate').innerText = dateStr;
    const content = document.getElementById('modalListContent');
    content.innerHTML = '';
    const list = allWords.filter(w => w.lastStudied && new Date(w.lastStudied).toISOString().startsWith(dateStr));

    if(list.length === 0) {
        content.innerHTML = '<div style="color:var(--text-dim); text-align:center;">기록 없음</div>';
    } else {
        list.forEach(w => {
            const row = document.createElement('div');
            row.style.cssText = "display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid rgba(255,255,255,0.05);";
            row.innerHTML = `<span>${w.word}</span><span style="color:var(--text-dim)">${w.mean}</span>`;
            content.appendChild(row);
        });
    }
}
function closeModal(e) { if(e.target === document.getElementById('wordListModal')) document.getElementById('wordListModal').style.display = 'none'; }

// ============================================================
// [Flow Logic] Phase 1: Preview
// ============================================================
function startFlow(list, type = 'normal') {
    if(!list || list.length === 0) return;

    sessionType = type;
    currentSession = list;

    // Daily가 아닐 경우만 섞음 (Daily는 목록이 고정되어야 함)
    if(type !== 'daily') currentSession.sort(() => 0.5 - Math.random());

    recalledWords = [];
    correctionQueue = [];
    retryQueue = [];
    currentIdx = 0;

    document.getElementById('resumeBanner').style.display = 'none';
    localStorage.removeItem('wow_session');

    startPreview();
}

function startPreview() {
    showPage('preview');
    document.getElementById('wordArea').style.display = 'block';
    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('giveUpBtn').style.display = 'none';
    document.getElementById('pBarWrap').style.display = 'block';

    document.getElementById('actionBtn').innerHTML = '다음 <span class="pc-hint">(Space)</span>';
    document.getElementById('actionBtn').onclick = () => {
        clearTimeout(window.pt);
        currentIdx++;
        nextPreview();
    };

    document.onkeyup = (e) => {
        if(curPhase === 'preview' && e.code === 'Space') {
            document.getElementById('actionBtn').click();
        }
    };

    nextPreview();
}

function nextPreview() {
    if(currentIdx >= currentSession.length) {
        startDump();
        return;
    }

    document.getElementById('phaseTag').innerText = `1. PREVIEW (${currentIdx + 1} / ${currentSession.length})`;
    saveSession();

    const w = currentSession[currentIdx];
    document.getElementById('mainWord').innerText = w.word;
    document.getElementById('mainMean').innerText = w.mean;
    playTTS(w.word);

    const bar = document.getElementById('pBar');
    bar.style.transition = 'none'; bar.style.width = '0%';
    setTimeout(() => {
        // ★ 설정값 userSettings 사용
        bar.style.transition = `width ${userSettings.previewTime}s linear`;
        bar.style.width = '100%';
    }, 50);

    clearTimeout(window.pt);
    window.pt = setTimeout(() => {
        currentIdx++;
        nextPreview();
    }, userSettings.previewTime * 1000);
}

function startDump() {
    // ★ [추가] 2단계 진입 사실을 확실히 저장
    // 1단계가 끝났으므로 currentIdx는 이미 list.length와 같음.
    // 이 상태를 저장해둬야 resumeFlow에서 1단계로 돌아가지 않음.
    saveSession();

    showPage('dump');
    document.onkeyup = null;
    window.speechSynthesis.cancel();

    if(!localStorage.getItem('wow_session')) correctionQueue = [];

    document.getElementById('phaseTag').innerText = "2. RECALL (인출)";
    document.getElementById('wordArea').style.display = 'none';
    document.getElementById('inputArea').style.display = 'block';
    document.getElementById('pBarWrap').style.display = 'none';

    resetInputUI();
}

function resetInputUI() {
    document.getElementById('feedbackMsg').innerText = "단어와 뜻을 입력하세요";
    document.getElementById('feedbackMsg').style.color = "var(--text)";

    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');

    wIn.value = ""; mIn.value = "";
    wIn.className = "input-box"; mIn.className = "input-box";
    wIn.readOnly = false;
    mIn.placeholder = "뜻 입력";

    document.getElementById('giveUpBtn').style.display = 'block';

    const btn = document.getElementById('actionBtn');
    btn.innerHTML = '확인 <span class="pc-hint">(Enter)</span>';
    btn.disabled = false;
    btn.onclick = handleDump;

    wIn.onkeyup = (e) => { if(e.key === 'Enter') mIn.focus(); };
    mIn.onkeyup = (e) => { if(e.key === 'Enter') handleDump(); };
    wIn.focus();
}

// async 추가
async function handleGiveUp() {
    // await myConfirm 사용
    const isConfirmed = await myConfirm("정말 2단계를 건너뛰고\n바로 오답 학습(3단계)을 하시겠습니까?\n\n(남은 단어는 모두 틀린 것으로 처리됩니다)");

    if(isConfirmed) {
        const processedIds = [...recalledWords, ...correctionQueue].map(w => w.id);
        const remaining = currentSession.filter(s => !processedIds.includes(s.id));

        remaining.forEach(w => {
            updateWord(w.id, false);
            correctionQueue.push(w);
        });

        myAlert(`남은 ${remaining.length}개 단어를 포함해 재학습합니다.`);
        saveSession();
        startCorrectionPhase();
    }
}

async function handleDump() {
    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');
    const inputWord = wIn.value.trim();
    const inputMean = mIn.value.trim();

    const handledIds = [...recalledWords, ...correctionQueue].map(w => w.id);
    const target = currentSession.find(s => !handledIds.includes(s.id) && s.word.toLowerCase() === inputWord.toLowerCase());

    if(!target) {
        updateFeedback("목록에 없거나 이미 처리된 단어입니다.", "wrong");
        return;
    }

    updateFeedback("AI 채점 중...", "processing");
    document.getElementById('actionBtn').disabled = true;

    const isCorrect = await checkAI(inputMean, target.mean, target.word);
    document.getElementById('actionBtn').disabled = false;

    if(isCorrect) {
        updateFeedback(`정답! ${target.word}`, "correct");
        recalledWords.push(target);
        await updateWord(target.id, true);
        setTimeout(checkPhase2End, 800);
    } else {
        updateFeedback(`오답입니다. (3단계 예약)`, "wrong");
        await updateWord(target.id, false);
        correctionQueue.push(target);
        setTimeout(checkPhase2End, 800);
    }
    saveSession();
}

function checkPhase2End() {
    const handledCount = recalledWords.length + correctionQueue.length;
    if (handledCount >= currentSession.length) {
        if (correctionQueue.length > 0) {
            startCorrectionPhase();
        } else {
            completeSession();
        }
    } else {
        resetInputUI();
    }
}

// ============================================================
// [Flow Logic] Phase 3: Correction
// ============================================================
function startCorrectionPhase() {
    saveSession();

    correctionIdx = 0;
    retryQueue = [];

    if(correctionQueue.length === 0) {
        completeSession();
        return;
    }
    processCorrectionItem();
}

function processCorrectionItem() {
    if (correctionIdx >= correctionQueue.length) {
        if (retryQueue.length > 0) {
            myAlert(`아직 ${retryQueue.length}개를 못 외웠습니다. 다시!`);
            correctionQueue = [...retryQueue];
            startCorrectionPhase();
        } else {
            completeSession();
        }
        return;
    }
    correctionTarget = correctionQueue[correctionIdx];
    showCorrectionView();
}

function showCorrectionView() {
    curPhase = 'correction_view';
    const currentNum = correctionIdx + 1;
    const totalNum = correctionQueue.length;

    document.getElementById('phaseTag').innerText = `3. RE-LEARN (${currentNum}/${totalNum})`;

    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('wordArea').style.display = 'block';
    document.getElementById('pBarWrap').style.display = 'block';
    document.getElementById('giveUpBtn').style.display = 'none';

    document.getElementById('mainWord').innerText = correctionTarget.word;
    document.getElementById('mainMean').innerText = correctionTarget.mean;
    playTTS(correctionTarget.word);

    const bar = document.getElementById('pBar');
    bar.style.transition = 'none'; bar.style.width = '0%';
    setTimeout(() => {
        // ★ 설정값 userSettings 사용
        bar.style.transition = `width ${userSettings.reLearnTime}s linear`;
        bar.style.width = '100%';
    }, 50);

    const btn = document.getElementById('actionBtn');
    btn.innerText = "암기 완료 (테스트)";
    btn.disabled = false;
    btn.onclick = showCorrectionInput;

    clearTimeout(window.pt);
    window.pt = setTimeout(showCorrectionInput, userSettings.reLearnTime * 1000);

    document.onkeyup = (e) => {
        if(curPhase === 'correction_view' && (e.code === 'Space' || e.code === 'Enter')) showCorrectionInput();
    };
}

function showCorrectionInput() {
    clearTimeout(window.pt);
    curPhase = 'correction_test';
    const currentNum = correctionIdx + 1;
    const totalNum = correctionQueue.length;
    document.getElementById('phaseTag').innerText = `3. RE-TEST (${currentNum}/${totalNum})`;

    document.getElementById('wordArea').style.display = 'none';
    document.getElementById('pBarWrap').style.display = 'none';
    document.getElementById('inputArea').style.display = 'block';

    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');

    document.getElementById('feedbackMsg').innerText = "방금 본 뜻을 입력하세요";
    document.getElementById('feedbackMsg').style.color = "var(--text)";

    wIn.value = correctionTarget.word;
    wIn.readOnly = true;
    mIn.value = "";
    mIn.className = "input-box";
    mIn.placeholder = "뜻 입력";
    mIn.focus();

    wIn.onkeyup = null;
    mIn.onkeyup = null;

    const btn = document.getElementById('actionBtn');
    btn.innerText = "확인";
    btn.onclick = checkCorrectionAnswer;

    document.onkeyup = (e) => {
        if(curPhase === 'correction_test' && e.code === 'Enter') {
            checkCorrectionAnswer();
        }
    };
}

async function checkCorrectionAnswer() {
    document.onkeyup = null;
    const btn = document.getElementById('actionBtn');
    if(btn) btn.onclick = null;
    if(btn) btn.disabled = true;

    const input = document.getElementById('inMean').value.trim();

    updateFeedback("채점 중...", "processing");

    const isCorrect = await checkAI(input, correctionTarget.mean, correctionTarget.word);

    if(isCorrect) {
        updateFeedback(`정답! ${correctionTarget.word} : ${correctionTarget.mean}`, "correct");
        setTimeout(() => {
            correctionIdx++;
            processCorrectionItem();
        }, 1500);
    } else {
        updateFeedback(`틀렸습니다. 정답: ${correctionTarget.mean}`, "wrong");
        retryQueue.push(correctionTarget);
        setTimeout(() => {
            correctionIdx++;
            processCorrectionItem();
        }, 2500);
    }
}

// ============================================================
// [Completion & Helpers]
// ============================================================
async function completeSession() {
    myAlert("학습 완료! 🎉");
    localStorage.removeItem('wow_session');

    if (sessionType === 'daily') {
        try {
            await db.collection('users').doc(auth.currentUser.uid).collection('meta').doc('daily').update({ finished: true });
        } catch(e) { console.log("Finish update fail", e); }
        dailyStatus.finished = true;
    }

    loadData();
}

function updateFeedback(msg, type) {
    const f = document.getElementById('feedbackMsg');
    f.innerText = msg;
    if(type === 'processing') {
        f.style.color = 'var(--text-dim)';
        document.getElementById('inMean').className = `input-box processing`;
    } else {
        f.style.color = type === 'correct' ? 'var(--accent)' : type === 'wrong' ? 'var(--error)' : 'var(--text)';
        if(curPhase !== 'correction_test') {
            document.getElementById('inWord').className = `input-box ${type}`;
        }
        document.getElementById('inMean').className = `input-box ${type}`;
    }
}

async function checkAI(userMean, correctMean, word) {
    if (!userMean) return false;
    if (userMean.replace(/\s/g, '') === correctMean.replace(/\s/g, '')) return true;

    try {
        const prompt = `Is "${userMean}" a correct meaning for the English word "${word}"?
The primary definition is "${correctMean}".
Reply ONLY with true or false.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: prompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 5
                    }
                })
            }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        const text =
            data.candidates?.[0]?.content?.parts
                ?.map(p => p.text)
                .join('')
                .trim()
                .toLowerCase();

        if (!text) return false;

        return text === 'true';

    } catch (e) {
        console.error("AI Check Error:", e);
        return correctMean.includes(userMean) || userMean.includes(correctMean);
    }
}

async function updateWord(id, isSuccess) {
    const ref = db.collection('users').doc(auth.currentUser.uid).collection('words').doc(id);
    const doc = await ref.get();
    if(!doc.exists) return;

    const data = doc.data();
    let box = data.box || 0;
    let nextInterval = 0;

    if(isSuccess) {
        box++;
        if(box === 1) nextInterval = 1;
        else if(box === 2) nextInterval = 3;
        else if(box === 3) nextInterval = 7;
        else if(box === 4) nextInterval = 15;
        else nextInterval = 30;
    } else {
        box = 0;
        nextInterval = 0;
    }

    const nextReview = Date.now() + (nextInterval * 24 * 60 * 60 * 1000);

    await ref.update({
        box: box,
        nextReview: nextReview,
        lastStudied: Date.now()
    });

    const localIdx = allWords.findIndex(w => w.id === id);
    if(localIdx > -1) {
        allWords[localIdx].box = box;
        allWords[localIdx].nextReview = nextReview;
        allWords[localIdx].lastStudied = Date.now();
    }
}

function playTTS(text) {
    window.speechSynthesis.cancel();
    if('speechSynthesis' in window) {
        setTimeout(() => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US';
            u.rate = 1.0;
            window.speechSynthesis.speak(u);
        }, 10);
    }
}

// ============================================================
// [Data Import & Export]
// ============================================================
async function importWords() {
    const setName = document.getElementById('setName').value.trim();
    const raw = document.getElementById('rawInput').value.trim();

    if(!setName || !raw) return myAlert("세트 이름과 단어를 입력하세요.");

    const lines = raw.split('\n');
    const batch = db.batch();
    const colRef = db.collection('users').doc(auth.currentUser.uid).collection('words');

    let count = 0;
    lines.forEach(line => {
        const parts = line.split('\t');
        if(parts.length >= 2) {
            const word = parts[0].trim();
            const mean = parts[1].trim();
            if(word && mean) {
                const docRef = colRef.doc();
                batch.set(docRef, {
                    word, mean, setName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    box: 0,
                    nextReview: Date.now()
                });
                count++;
            }
        }
    });

    if(count > 0) {
        await batch.commit();
        document.getElementById('rawInput').value = '';
        document.getElementById('setName').value = '';
        myAlert(`${count}개 단어 저장 완료!`);
        loadData();
    } else {
        myAlert("유효한 단어 형식이 아닙니다. (단어[탭]뜻)");
    }
}

function renderAccordion() {
    const wrap = document.getElementById('accordionWrap');
    if(!wrap) return;
    wrap.innerHTML = "";
    const sets = {};
    allWords.forEach(w => {
        const k = w.setName || '기타';
        if(!sets[k]) sets[k] = [];
        sets[k].push(w);
    });

    Object.keys(sets).forEach(setName => {
        const list = sets[setName];
        const el = document.createElement('div');
        el.innerHTML = `
            <div class="set-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='none'?'block':'none'">
                <span>${setName} (${list.length})</span>
                <span>▼</span>
            </div>
            <div style="display:none; padding:10px;">
                ${list.map(w => `
                    <div class="word-item">
                        <div>
                            <div style="font-weight:700">${w.word}</div>
                            <div style="font-size:0.9rem; color:var(--text-dim)">${w.mean}</div>
                        </div>
                        <button class="delete-btn" onclick="deleteWord('${w.id}')">삭제</button>
                    </div>
                `).join('')}
            </div>
        `;
        wrap.appendChild(el);
    });
}

// async 추가
async function deleteWord(id) {
    // await myConfirm 사용
    const isConfirmed = await myConfirm("정말 이 단어를 영구 삭제하시겠습니까?");

    if(isConfirmed) {
        await db.collection('users').doc(auth.currentUser.uid).collection('words').doc(id).delete();
        loadData();
    }
}

// [app.js] saveSession 함수 수정
function saveSession() {
    const data = {
        list: currentSession,
        recalled: recalledWords.map(w => w.id),
        correction: correctionQueue.map(w => w.id),

        // ★ [추가] 3단계용 데이터
        retry: retryQueue.map(w => w.id),
        cIdx: correctionIdx,

        idx: currentIdx, // 1단계용
        timestamp: Date.now(),
        type: sessionType
    };
    localStorage.setItem('wow_session', JSON.stringify(data));
}

// [app.js] checkResume 함수 교체
function checkResume() {
    const saved = localStorage.getItem('wow_session');
    if (!saved) return;

    const data = JSON.parse(saved);

    // 1. 시간 초과 체크 (30분)
    if (Date.now() - data.timestamp > 30 * 60 * 1000) {
        localStorage.removeItem('wow_session');
        return;
    }

    // ★ [추가] 데이터 유효성 검사 (DB 초기화 대응)
    // 저장된 학습 목록(data.list)의 모든 단어가 현재 로드된 allWords에 실제로 존재하는지 확인
    const isValid = data.list.every(savedItem =>
        allWords.some(realItem => realItem.id === savedItem.id)
    );

    // DB에 없는 단어가 포함되어 있다면 세션 파기
    if (!isValid) {
        console.log("DB 데이터 불일치로 세션 삭제됨");
        localStorage.removeItem('wow_session');
        return;
    }

    // --- 이하 기존 로직과 동일 ---
    const total = data.list.length;
    let titleText = "학습하던 기록이 있습니다";
    let descText = "";

    const phase2Done = (data.recalled ? data.recalled.length : 0) + (data.correction ? data.correction.length : 0);

    if (data.idx < total) {
        descText = `1단계 Preview: <b>${data.idx + 1} / ${total}</b> 진행 중`;
    } else if (phase2Done < total) {
        descText = `2단계 Recall: <b>${phase2Done + 1} / ${total}</b> 진행 중`;
    } else {
        const qLen = data.correction ? data.correction.length : 0;
        const cIdx = data.cIdx || 0;
        descText = `3단계 Re-learn: <b>${cIdx + 1} / ${qLen}</b> 번째 학습 중`;
    }

    const banner = document.getElementById('resumeBanner');
    banner.innerHTML = `
        <div class="resume-info">
            <h3>${titleText}</h3>
            <p>${descText}</p>
        </div>
        <div class="resume-actions">
            <button onclick="resumeFlow()" class="btn-resume-go">이어하기</button>
            <button onclick="cancelSession()" class="btn-resume-cancel">취소</button>
        </div>
    `;
    banner.style.display = 'flex';
}

// [app.js] resumeFlow 함수 교체
function resumeFlow() {
    const saved = JSON.parse(localStorage.getItem('wow_session'));
    if(!saved) return;

    // ★ [수정] currentSession 복구 시 allWords와 매핑하여 죽은 객체 필터링
    // 저장된 리스트의 ID를 기반으로 실제 존재하는(allWords) 객체만 가져옴
    currentSession = saved.list
        .map(savedItem => allWords.find(w => w.id === savedItem.id))
        .filter(item => item !== undefined);

    // 만약 복구했더니 단어가 하나도 없다면? (DB 전체 삭제 상황)
    if (currentSession.length === 0) {
        myAlert("원본 데이터가 삭제되어 이어할 수 없습니다.");
        localStorage.removeItem('wow_session');
        document.getElementById('resumeBanner').style.display = 'none';
        return;
    }

    sessionType = saved.type || 'normal';

    // 나머지 큐 복구 (마찬가지로 실존 여부 확인)
    recalledWords = saved.recalled.map(id => allWords.find(w => w.id === id)).filter(x=>x);
    correctionQueue = saved.correction.map(id => allWords.find(w => w.id === id)).filter(x=>x);

    currentIdx = saved.idx;

    if (saved.retry) {
        retryQueue = saved.retry.map(id => allWords.find(w => w.id === id)).filter(x=>x);
    }
    if (saved.cIdx !== undefined) {
        correctionIdx = saved.cIdx;
    }

    document.getElementById('resumeBanner').style.display = 'none';

    const total = currentSession.length;
    const phase2Progress = recalledWords.length + correctionQueue.length;

    // --- 분기 처리 ---
    if (currentIdx < total) {
        startPreview();
    }
    else if (phase2Progress < total) {
        startDump();
    }
    else {
        showPage('dump');
        document.getElementById('phaseTag').innerText = "3. RE-LEARN (재학습)";
        document.getElementById('wordArea').style.display = 'none';
        document.getElementById('inputArea').style.display = 'block';
        document.getElementById('pBarWrap').style.display = 'none';
        resetInputUI();
        processCorrectionItem();
    }
}
// 취소 함수 (기존과 동일)
// async 추가
async function cancelSession() {
    // await myConfirm 사용
    const isConfirmed = await myConfirm("저장된 학습 기록을 삭제하고\n홈으로 돌아가시겠습니까?");

    if(isConfirmed) {
        localStorage.removeItem('wow_session');
        document.getElementById('resumeBanner').style.display = 'none';
    }
}
// [Helper] 커스텀 Confirm 함수 (Promise 기반)
function myConfirm(msg) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const msgEl = document.getElementById('confirmMsg');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        msgEl.innerText = msg;
        modal.style.display = 'flex';

        // 버튼 클릭 시 이벤트 처리 (일회성)
        const close = (result) => {
            modal.style.display = 'none';
            yesBtn.onclick = null;
            noBtn.onclick = null;
            resolve(result);
        };

        yesBtn.onclick = () => close(true);
        noBtn.onclick = () => close(false);
    });
}