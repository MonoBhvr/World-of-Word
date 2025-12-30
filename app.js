const firebaseConfig = { apiKey: "AIzaSyB4YI3_w6bXIcxXB7gC7Xnzo9biEKVGSqM", authDomain: "ciaword-a7c51.firebaseapp.com", projectId: "ciaword-a7c51", storageBucket: "ciaword-a7c51.firebasestorage.app", messagingSenderId: "566446687672", appId: "1:566446687672:web:ea63701602a00ac28a7b4d" };

window.addEventListener('load', () => {
    const savedKey = localStorage.getItem('userApiKey');
    if(savedKey) {
        window.GEMINI_KEY = savedKey;
        document.getElementById('apiKeyPrompt').style.display = 'none';
        if(document.getElementById('settingsApiKey')) {
            document.getElementById('settingsApiKey').value = savedKey;
        }
    } else {
        document.getElementById('apiKeyPrompt').style.display = 'flex';
    }
});



firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();


// ============================================================
// [Global Variables]
// ============================================================
let allWords = [];          // 전체 단어 목록 (DB 로드됨)
let currentSession = [];    // 현재 학습 중인 단어 목록
let recalledWords = [];     // 2단계 통과한 단어
let correctionQueue = [];   // 2단계 실패 -> 3단계 대상
let retryQueue = [];        // 3단계 재시험 큐
let currentIdx = 0;         // 1단계 진행 인덱스
let correctionIdx = 0;      // 3단계 진행 인덱스
let curPhase = 'home';      // 현재 화면 상태
let sessionType = 'normal'; // 'daily', 'review', 'normal'
let dailyStatus = { finished: false , date : "" }; // 오늘 학습 완료 여부
let correctionTarget = null;
let pt = null;              // 타이머 핸들

// 사용자 설정 (기본값 + 로컬스토리지 복구)
let userSettings = JSON.parse(localStorage.getItem('wow_settings')) || {
    previewTime: 2.0,
    reLearnTime: 3.0,
    dailyGoal: 20
};


// ============================================================
// [Auth & Initialization]
// ============================================================
auth.onAuthStateChanged((user) => {
    if (user) {
        console.log("Logged in:", user.email);
        loadData();
        showPage('page-home');
    } else {
        console.log("Logged out");
        showPage('page-auth');
    }
});

window.login = function() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(e => myAlert("로그인 실패: " + e.message));
};

window.logout = function() {
    auth.signOut();
    location.reload();
};

async function loadData() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    // 1. 전체 데이터 한 번에 로드 (RTDB)
    const snapshot = await db.ref('users/' + uid).once('value');
    const data = snapshot.val() || {};

    // 2. 단어 변환 (Object -> Array)
    const wordsObj = data.words || {};
    allWords = Object.keys(wordsObj).map(key => ({
        id: key,
        ...wordsObj[key]
    }));

    // 3. 설정 및 데일리 상태 로드
    if (data.settings) userSettings = { ...userSettings, ...data.settings };
    dailyStatus = data.daily || {};

    // 4. UI 업데이트
    updateSettingUI();
    renderDashboard();
    if(typeof renderAccordion === 'function') renderAccordion();
    if(typeof checkResume === 'function') checkResume();
    if(typeof renderStreak === 'function') renderStreak();
    loadDailyEtymology();
}

// ============================================================
// [Settings Logic]
// ============================================================
window.toggleSettings = function() {
    document.getElementById('settingsOverlay').classList.toggle('open');
};

function updateSettingUI() {
    if(document.getElementById('previewTimeVal')) document.getElementById('previewTimeVal').innerText = userSettings.previewTime.toFixed(1) + 's';
    if(document.getElementById('reLearnTimeVal')) document.getElementById('reLearnTimeVal').innerText = userSettings.reLearnTime.toFixed(1) + 's';
    if(document.getElementById('dailyGoalVal')) document.getElementById('dailyGoalVal').innerText = userSettings.dailyGoal;
}

window.adjSetting = async function(key, val) {
    let current = userSettings[key];
    let newVal = current + val;

    if (key === 'previewTime') {
        if (newVal < 0.5) newVal = 0.5; if (newVal > 5.0) newVal = 5.0;
    } else if (key === 'reLearnTime') {
        if (newVal < 1.0) newVal = 1.0; if (newVal > 10.0) newVal = 10.0;
    } else if (key === 'dailyGoal') {
        if (newVal < 5) newVal = 5; if (newVal > 100) newVal = 100;
    }

    if (key !== 'dailyGoal') newVal = Math.round(newVal * 10) / 10;

    userSettings[key] = newVal;
    updateSettingUI();

    if (auth.currentUser) {
        await db.ref(`users/${auth.currentUser.uid}/settings`).set(userSettings);
    }
};

// ============================================================
// [Dashboard & Navigation]
// ============================================================
function renderDashboard() {
    const now = Date.now();
    // 데이터 필터링
    const reviewList = allWords.filter(w => w.nextReview && w.nextReview <= now);
    const unstudiedWords = allWords.filter(w => !w.lastStudied);

    // 사용자 이름/날짜 표시
    if(document.getElementById('currentDateDisp')) {
        document.getElementById('currentDateDisp').innerText = new Date().toLocaleDateString();
    }
    if(document.getElementById('userNameDisp') && auth.currentUser) {
        document.getElementById('userNameDisp').innerText = auth.currentUser.email.split('@')[0];
    }

    if(dailyStatus.date !== new Date().toLocaleDateString()){
        dailyStatus.finished = false;
    }

    const countToday = dailyStatus.finished ? "완료" : Math.min(unstudiedWords.length, userSettings.dailyGoal);

    // UI 숫자 업데이트
    if(document.getElementById('heroCount')) document.getElementById('heroCount').innerText = countToday;
    if(document.getElementById('heroGoal')) document.getElementById('heroGoal').innerText = userSettings.dailyGoal;
    if(document.getElementById('countToday')) document.getElementById('countToday').innerText = dailyStatus.finished ? userSettings.dailyGoal : 0;
    if(document.getElementById('goalDisp')) document.getElementById('goalDisp').innerText = userSettings.dailyGoal;
    if(document.getElementById('countReview')) document.getElementById('countReview').innerText = reviewList.length;

    // 학습 완료 여부에 따른 카드 전환
    const heroArea = document.getElementById('heroArea');
    const smallCard = document.getElementById('todaySmallCard');

    if (dailyStatus.finished) {
        if(heroArea) heroArea.style.display = 'none';
        if(smallCard) smallCard.style.display = 'flex';
        // 진행바 채우기
        const bar = document.getElementById('todayProgressBar');
        if(bar) setTimeout(() => bar.style.width = '100%', 100);
    } else {
        if(heroArea) heroArea.style.display = 'block';
        if(smallCard) smallCard.style.display = 'none';
    }
}

window.showPage = function(id) {
    // 1. 네비게이션바 처리
    const sidebar = document.getElementById('sidebar');
    const mobileNav = document.getElementById('mobileNav');

    // 2. 로그인 페이지 vs 메인 페이지 전환 로직
    if (id === 'page-auth') {
        document.getElementById('page-auth').style.display = 'flex';
        document.getElementById('mainArea').style.display = 'none';
        if(sidebar) sidebar.style.display = 'none';
        if(mobileNav) mobileNav.style.display = 'none';
        return; // 로그인 페이지면 여기서 중단
    } else {
        loadData();
        document.getElementById('page-auth').style.display = 'none';
        document.getElementById('mainArea').style.display = 'block';
        if(sidebar) sidebar.style.display = 'flex';
        const isMobile = window.innerWidth <= 768;

        if (mobileNav) {
            mobileNav.style.display = isMobile ? 'flex' : 'none';
        }
    }

    // 3. 내부 페이지 전환
    curPhase = id;
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

    // id가 home, manage가 아니면 learn 페이지로 간주
    let targetId = id;
    if(['preview', 'dump', 'correction_view', 'correction_test'].includes(id)) {
        targetId = 'page-learn';
    }
    else if (!id.startsWith('page-')) {
        targetId = 'page-' + id;
    }

    const page = document.getElementById(targetId) || document.getElementById('page-' + id);
    if(page) page.style.display = 'block';

    // 4. 메뉴 버튼 활성화 표시
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-${id.replace('page-', '')}`);
    if(activeBtn) activeBtn.classList.add('active');

    // 타이머 정리
    if(id !== 'preview' && id !== 'correction_view') clearTimeout(window.pt);
};
// ============================================================
// [Core Learning Logic] 0. Start Flow
// ============================================================

window.handleGiveUp = async function() {
    const isConfirmed = await myConfirm("정말 2단계를 건너뛰고\n바로 오답 학습(3단계)을 하시겠습니까?");
    if(isConfirmed) {
        const processedIds = [...recalledWords, ...correctionQueue].map(w => w.id);
        const remaining = currentSession.filter(s => !processedIds.includes(s.id));

        remaining.forEach(w => {
            updateWord(w.id, false);
            correctionQueue.push(w);
        });
        saveSession();
        startCorrectionPhase();
    }
};


// ============================================================
// [Helpers & Resume Logic]
// ============================================================
async function updateWord(id, isSuccess) {
    if(!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const wordRef = db.ref(`users/${uid}/words/${id}`);
    const snapshot = await wordRef.once('value');
    const data = snapshot.val();

    if (!data) return;

    let box = data.box || 0;
    let nextInterval = 0;

    if (isSuccess) {
        box++;
        if (box === 1) nextInterval = 1;
        else if (box === 2) nextInterval = 3;
        else if (box === 3) nextInterval = 7;
        else if (box === 4) nextInterval = 15;
        else nextInterval = 30;
    } else {
        box = 0;
        nextInterval = 0;
    }

    const nextReview = Date.now() + (nextInterval * 24 * 60 * 60 * 1000);

    await wordRef.update({
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

window.saveSession = function() {
    const data = {
        list: currentSession,
        recalled: recalledWords.map(w => w.id),
        correction: correctionQueue.map(w => w.id),
        retry: retryQueue.map(w => w.id),
        cIdx: correctionIdx,
        idx: currentIdx,
        timestamp: Date.now(),
        type: sessionType
    };
    localStorage.setItem('wow_session', JSON.stringify(data));
};

window.checkResume = function() {
    const saved = localStorage.getItem('wow_session');
    if (!saved) return;

    let data;
    try {
        data = JSON.parse(saved);
    } catch(e) {
        localStorage.removeItem('wow_session');
        return;
    }

    // 1. 타임아웃 30분 체크
    if (Date.now() - data.timestamp > 30 * 60 * 1000) {
        localStorage.removeItem('wow_session');
        return;
    }

    // 2. DB 유효성 검사 (학습하던 단어가 실제 DB에 여전히 존재하는지)
    // allWords가 로드되기 전에 실행될 수 있으므로 방어 코드 추가
    if (!allWords || allWords.length === 0) return;

    const isValid = data.list.every(savedItem =>
        allWords.some(realItem => realItem.id === savedItem.id)
    );

    if (!isValid) {
        console.log("DB 데이터 불일치로 세션 삭제됨");
        localStorage.removeItem('wow_session');
        return;
    }

    // 3. 배너에 표시할 문구 생성
    const total = data.list.length;
    let descText = "";
    const phase2Done = (data.recalled ? data.recalled.length : 0) + (data.correction ? data.correction.length : 0);

    if (data.idx < total) {
        descText = `1단계 Preview: <b>${data.idx + 1} / ${total}</b> 진행 중`;
    } else if (phase2Done < total) {
        descText = `2단계 Recall: <b>${phase2Done + 1} / ${total}</b> 진행 중`;
    } else {
        const qLen = data.correction ? data.correction.length : 0;
        const cIdx = data.cIdx || 0;
        descText = `3단계 Re-learn: <b>${cIdx + 1} / ${qLen}</b> 진행 중`;
    }

    // 4. 배너 HTML 렌더링 (이 부분이 오류 수정 핵심입니다)
    const banner = document.getElementById('resumeBanner');
    if(banner) {
        banner.innerHTML = `
            <div class="resume-info">
                <h3>학습하던 기록이 있습니다</h3>
                <p>${descText}</p>
            </div>
            <div class="resume-actions">
                <button onclick="resumeFlow()" class="btn-resume-go">이어하기</button>
                <button onclick="cancelSession()" class="btn-resume-cancel">취소</button>
            </div>
        `;
        banner.style.display = 'flex';
    }
};

window.resumeFlow = function() {
    const saved = JSON.parse(localStorage.getItem('wow_session'));
    if(!saved) return;

    currentSession = saved.list
        .map(savedItem => allWords.find(w => w.id === savedItem.id))
        .filter(item => item !== undefined);

    if (currentSession.length === 0) {
        myAlert("이어할 데이터가 없습니다.");
        localStorage.removeItem('wow_session');
        document.getElementById('resumeBanner').style.display = 'none';
        return;
    }

    sessionType = saved.type || 'normal';
    recalledWords = saved.recalled.map(id => allWords.find(w => w.id === id)).filter(x=>x);
    correctionQueue = saved.correction.map(id => allWords.find(w => w.id === id)).filter(x=>x);
    currentIdx = saved.idx;
    if (saved.retry) retryQueue = saved.retry.map(id => allWords.find(w => w.id === id)).filter(x=>x);
    if (saved.cIdx !== undefined) correctionIdx = saved.cIdx;

    document.getElementById('resumeBanner').style.display = 'none';

    const total = currentSession.length;
    const phase2Progress = recalledWords.length + correctionQueue.length;

    if (currentIdx < total) startPreview();
    else if (phase2Progress < total) startDump();
    else {
        showPage('dump');
        document.getElementById('wordArea').style.display = 'none';
        document.getElementById('inputArea').style.display = 'block';
        document.getElementById('pBarWrap').style.display = 'none';
        processCorrectionItem();
    }
};

window.cancelSession = async function() {
    const isConfirmed = await myConfirm("저장된 학습 기록을 삭제하시겠습니까?");
    if(isConfirmed) {
        localStorage.removeItem('wow_session');
        document.getElementById('resumeBanner').style.display = 'none';
    }
};

// ============================================================
// [Utilities: TTS, Import/Export, Streak, Etymology]
// ============================================================
function playTTS(text) {
    window.speechSynthesis.cancel();
    if('speechSynthesis' in window) {
        setTimeout(() => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US';
            window.speechSynthesis.speak(u);
        }, 10);
    }
}

function updateFeedback(msg, type) {
    const f = document.getElementById('feedbackMsg');
    f.innerText = msg;
    if(type === 'processing') {
        f.style.color = 'var(--text-dim)';
    } else {
        f.style.color = type === 'correct' ? 'var(--accent)' : type === 'wrong' ? 'var(--error)' : 'var(--text)';
        document.getElementById('inMean').className = `input-box ${type}`;
    }
}

window.myAlert = function(msg) {
    const el = document.getElementById('customAlert');
    if(!el) return alert(msg);
    document.getElementById('alertMsg').innerText = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
};

window.myConfirm = function(msg) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const msgEl = document.getElementById('confirmMsg');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        msgEl.innerText = msg;
        modal.style.display = 'flex';

        const close = (result) => {
            modal.style.display = 'none';
            yesBtn.onclick = null;
            noBtn.onclick = null;
            resolve(result);
        };
        yesBtn.onclick = () => close(true);
        noBtn.onclick = () => close(false);
    });
};

function closeModal(e) {
    if (e.target.classList.contains("modal-overlay")) {
        e.target.style.display = "none";
    }
}


window.importWords = async function() {
    const raw = document.getElementById('rawInput').value.trim();
    const setName = document.getElementById('setName').value.trim() || 'No Name';
    if (!raw) return myAlert('내용을 입력하세요.');

    const uid = auth.currentUser.uid;
    const lines = raw.split('\n');
    const updates = {};
    const now = Date.now();
    let count = 0;

    lines.forEach(line => {
        const [w, m] = line.split(/[\t]+/).map(s => s?.trim());
        if (w && m) {
            const newKey = db.ref().child('users').child(uid).child('words').push().key;
            updates[`users/${uid}/words/${newKey}`] = {
                word: w, mean: m, set: setName,
                box: 0, nextReview: 0, addedAt: now
            };
            count++;
        }
    });

    if (count > 0) {
        await db.ref().update(updates);
        myAlert(`${count}개 단어 저장 완료!`);
        document.getElementById('rawInput').value = '';
        loadData();
    }
};

window.renderAccordion = function() {
    const wrap = document.getElementById('accordionWrap');
    if(!wrap) return;
    wrap.innerHTML = "";
    const sets = {};
    allWords.forEach(w => {
        const k = w.set || w.setName || '기타';
        if(!sets[k]) sets[k] = [];
        sets[k].push(w);
    });

    Object.keys(sets).forEach(setName => {
        const list = sets[setName];
        const el = document.createElement('div');
        el.innerHTML = `
            <div class="set-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='none'?'block':'none'">
                <div style="display:flex; align-items:center; gap:10px; width:100%;">
                    <span>${setName} (${list.length})</span>
                    <button class="action-btn-small" onclick="event.stopPropagation(); shareSet('${setName}')">📤</button>
                    <span style="margin-left:auto">▼</span>
                </div>
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
};

window.deleteWord = async function(id) {
    const ok = await myConfirm("삭제하시겠습니까?");
    if(ok) {
        await db.ref(`users/${auth.currentUser.uid}/words/${id}`).remove();
        loadData();
    }
};

window.shareSet = async function(setName) {
    const targetWords = allWords.filter(w => (w.set || w.setName) === setName);
    if(targetWords.length === 0) return myAlert("단어가 없습니다.");

    const ok = await myConfirm(`'${setName}' 단어장 공유?`);
    if(!ok) return;

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await db.ref(`shared_books/${code}`).set({
        title: setName,
        author: auth.currentUser.email.split('@')[0],
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        words: targetWords.map(w => ({ word: w.word, mean: w.mean }))
    });
    myAlert(`공유 코드: ${code}`);
    navigator.clipboard.writeText(code);
};

window.downloadSharedBook = async function() {
    const code = document.getElementById('shareCodeInput').value.trim().toUpperCase();
    if(!code) return;

    const snapshot = await db.ref(`shared_books/${code}`).once('value');
    if(!snapshot.exists()) return myAlert("잘못된 코드입니다.");

    const data = snapshot.val();
    const ok = await myConfirm(`'${data.title}' 단어장을 다운로드할까요?`);
    if(!ok) return;

    const updates = {};
    const uid = auth.currentUser.uid;
    data.words.forEach(w => {
        const key = db.ref().push().key;
        updates[`users/${uid}/words/${key}`] = {
            word: w.word, mean: w.mean, set: data.title,
            box: 0, nextReview: Date.now(), addedAt: Date.now()
        };
    });
    await db.ref().update(updates);
    myAlert("다운로드 완료!");
    loadData();
};

async function loadDailyEtymology() {
    const todayKey = new Date().toISOString().split('T')[0];
    const etyRef = db.ref('daily_etymology/' + todayKey);
    try {
        const snapshot = await etyRef.once('value');
        if (snapshot.exists()) {
            const data = snapshot.val();
            renderEtymology(data.word, data.desc);
        } else {
            await generateWithGemini(etyRef);
        }
    } catch (e) { console.error(e); }
}

function renderEtymology(word, desc) {
    const wEl = document.getElementById('etyWord');
    const dEl = document.getElementById('etyDesc');
    if(wEl) wEl.innerText = word;
    if(dEl) dEl.innerText = desc;
}

// 스트릭(Streak) 관련
// ============================================================
// [Streak Logic - Original Working Version]
// ============================================================
const periodConfig = {
    '3m': { days: 90, size: 28 },
    '6m': { days: 180, size: 16 },
    '1y': { days: 365, size: 8 }
};

const savedPeriod = localStorage.getItem('saved_streak_period');
let currentPeriod = periodConfig[savedPeriod] ? savedPeriod : '1y';

document.documentElement.style.setProperty(
    '--cell-size',
    periodConfig[currentPeriod].size + 'px'
);

window.changePeriod = function (p) {
    if (!periodConfig[p]) return;

    currentPeriod = p;
    localStorage.setItem('saved_streak_period', p);

    document.querySelectorAll('.streak-btns button')
        .forEach(b => b.classList.remove('active'));

    const btn = document.getElementById(`btn-${p}`);
    if (btn) btn.classList.add('active');

    document.documentElement.style.setProperty(
        '--cell-size',
        periodConfig[p].size + 'px'
    );

    renderStreak();
};


function renderStreak() {
    const grid = document.getElementById('streakGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!periodConfig[currentPeriod]) {
        currentPeriod = '1y';
        localStorage.setItem('saved_streak_period', '1y');
    }

    const history = {};
    allWords.forEach(w => {
        if (!w.lastStudied) return;
        const d = new Date(w.lastStudied);
        const offset = d.getTimezoneOffset() * 60000;
        const local = new Date(d.getTime() - offset)
            .toISOString()
            .split('T')[0];
        history[local] = (history[local] || 0) + 1;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalDays = periodConfig[currentPeriod].days;

    const start = new Date(today);
    start.setDate(start.getDate() - totalDays + 1);

    const dayOfWeek = start.getDay(); // 0=일 ~ 6=토
    start.setDate(start.getDate() - dayOfWeek);

    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
        const offset = d.getTimezoneOffset() * 60000;
        const dateStr = new Date(d.getTime() - offset)
            .toISOString()
            .split('T')[0];

        const count = history[dateStr] || 0;

        const el = document.createElement('div');
        el.className = 'day';

        if (count === 0) el.style.background = 'var(--gh-empty)';
        else if (count <= 5) el.style.background = 'var(--gh-l1)';
        else if (count <= 10) el.style.background = 'var(--gh-l2)';
        else if (count <= 20) el.style.background = 'var(--gh-l3)';
        else el.style.background = 'var(--gh-l4)';

        el.onmousemove = e => {
            const t = document.getElementById('streakTooltip');
            t.innerHTML = `<b>${dateStr}</b><br>${count} words`;
            t.style.left = e.clientX + 12 + 'px';
            t.style.top = e.clientY + 12 + 'px';
            t.style.opacity = '1';
        };

        el.onmouseleave = () =>
            (document.getElementById('streakTooltip').style.opacity = '0');

        el.onclick = () => openStreakModal(dateStr);

        grid.appendChild(el);
    }

    const scroll = document.querySelector('.streak-scroll-view');
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
}

// 초기 스트릭 상태 복원
(function initStreakPeriod() {
    const btn = document.getElementById(`btn-${currentPeriod}`);
    if (btn) btn.classList.add('active');

    document.documentElement.style.setProperty(
        '--cell-size',
        periodConfig[currentPeriod].size + 'px'
    );

    renderStreak();
})();

function showStreakTooltip(el, date, count) {
    const tip = document.getElementById('streakTooltip');
    if (!tip) return;

    tip.innerHTML = `
        <strong>${date}</strong><br>
        ${count}개 학습
    `;

    tip.classList.add('show');

    el._moveHandler = (e) => {
        tip.style.left = (e.clientX + 12) + 'px';
        tip.style.top  = (e.clientY - 28) + 'px';
    };

    document.addEventListener('mousemove', el._moveHandler);
}
document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem('saved_streak_period');
    changePeriod(periodConfig[saved] ? saved : '1y');
});


function hideStreakTooltip() {
    const tip = document.getElementById('streakTooltip');
    if (tip) tip.classList.remove('show');

    document.removeEventListener('mousemove', this?._moveHandler);
}

window.openStreakModal = function (dateStr) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const header = document.createElement('div');
    header.className = 'streak-modal-header';

    const title = document.createElement('h3');
    title.textContent = dateStr;

    const close = document.createElement('button');
    close.className = 'streak-modal-close';
    close.textContent = '×';
    close.onclick = () => overlay.remove();

    header.appendChild(title);
    header.appendChild(close);

    const list = document.createElement('div');
    list.className = 'streak-word-list';

    const words = allWords.filter(w => {
        if (!w.lastStudied) return false;
        const d = new Date(w.lastStudied);
        const offset = d.getTimezoneOffset() * 60000;
        const local = new Date(d.getTime() - offset)
            .toISOString()
            .split('T')[0];
        return local === dateStr;
    });

    if (words.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'streak-word-empty';
        empty.textContent = '이 날 학습한 단어가 없습니다';
        list.appendChild(empty);
    } else {
        words.forEach(w => {
            const item = document.createElement('div');
            item.className = 'streak-word-item';

            const term = document.createElement('div');
            term.className = 'streak-word-term';
            term.textContent = w.word || w.term || '';

            const meaning = document.createElement('div');
            meaning.className = 'streak-word-meaning';
            meaning.textContent = w.mean || w.definition || '';

            item.appendChild(term);
            item.appendChild(meaning);
            list.appendChild(item);
        });
    }

    box.appendChild(header);
    box.appendChild(list);
    overlay.appendChild(box);

    overlay.onclick = e => {
        if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
};

function endCurrentSession() {
    if(currentSession && currentSession.length > 0) {
        saveSession(); // 기존 학습 저장
        currentSession = []; // 세션 초기화
        showPage('main'); // 필요한 경우 메인 화면으로
    }
}

// HTML 버튼과 연결되는 함수들
window.startDailySession = function() {
    endCurrentSession(); // 기존 세션 종료
    if (dailyStatus.finished && dailyStatus.date === new Date().toLocaleDateString()) {
        if(allWords.length === 0) return myAlert("단어가 없습니다.");
        const randomList = allWords.slice().sort(() => 0.5 - Math.random()).slice(0, userSettings.dailyGoal);
        startFlow(randomList, 'normal');
    } else {
        const unstudiedWords = allWords.filter(w => !w.lastStudied);
        if (unstudiedWords.length === 0) return myAlert("신규 학습할 단어가 없습니다! (단어 추가 필요)");
        const sessionList = unstudiedWords.slice(0, userSettings.dailyGoal);
        startFlow(sessionList, 'daily');
    }
};

window.startReviewSession = function() {
    endCurrentSession(); // 기존 세션 종료

    const now = Date.now();
    const reviewList = allWords.filter(w => w.nextReview && w.nextReview <= now);
    if(reviewList.length === 0) return myAlert("복습할 단어가 없습니다.");

    reviewList.sort((a,b) => a.nextReview - b.nextReview);

    // UI 초기화
    document.getElementById('phaseTag').innerText = "1. PRESENT (학습)";
    document.getElementById('wordArea').style.display = 'block';
    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('pBarWrap').style.display = 'block';
    resetInputUI();

    startFlow(reviewList.slice(0, userSettings.dailyGoal), 'review'); // 항상 1단계부터 시작
};


function createDayCell(dateStr, words) {
    const day = document.createElement("div");
    day.className = "day";

    const date = new Date(dateStr);
    const dow = date.getDay(); // 0(일) ~ 6(토)

    const count = words ? words.length : 0;

    day.dataset.date = dateStr;
    day.dataset.count = count;
    day.dataset.words = JSON.stringify(words || []);

    // ★ 핵심: 요일을 행으로 고정
    day.style.gridRow = dow + 1;

    day.addEventListener("click", () => {
        openStreakDetail(day);
    });

    return day;
}

document.addEventListener("touchstart", () => {}, { passive: true });
function toggleApiKey() {
    const input = document.getElementById('settingsApiKey');
    const openEye = document.querySelector('.toggle-visibility .eye.open');
    const closedEye = document.querySelector('.toggle-visibility .eye.closed');

    if(input.type === 'password') {
        input.type = 'text';
        openEye.style.display = 'none';
        closedEye.style.display = 'block';
    } else {
        input.type = 'password';
        openEye.style.display = 'block';
        closedEye.style.display = 'none';
    }
}
