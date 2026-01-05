// ============================================================
// [Start Learning Flow]
// ============================================================
window.startFlow = function(list, type = 'normal') {
    if(!list || list.length === 0) return;

    sessionType = type;
    currentSession = [...list];
    recalledWords = [];
    correctionQueue = [];
    retryQueue = [];
    currentIdx = 0;
    correctionIdx = 0;

    localStorage.removeItem('wow_session');

    startPreview();
};

// ============================================================
// [1. Preview Phase]
// ============================================================
function startPreview() {
    showPage('preview');
    document.getElementById('wordArea').style.display = 'block';
    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('giveUpBtn').style.display = 'none';
    document.getElementById('pBarWrap').style.display = 'block';

    const actionBtn = document.getElementById('actionBtn');
    actionBtn.innerHTML = '다음 <span class="pc-hint">(Space)</span>';
    actionBtn.onclick = () => {
        clearTimeout(pt);
        currentIdx++;
        nextPreview();
    };

    document.onkeyup = (e) => {
        if(e.code === 'Space') document.getElementById('actionBtn').click();
    };

    nextPreview();
}

function nextPreview() {
    if(currentIdx >= currentSession.length) {
        startDump();
        return;
    }

    document.getElementById('phaseTag').innerText = `1. PREVIEW (${currentIdx + 1}/${currentSession.length})`;
    saveSession();

    const w = currentSession[currentIdx];
    document.getElementById('mainWord').innerText = w.word;
    document.getElementById('mainMean').innerText = w.mean;
    playTTS(w.word);

    const bar = document.getElementById('pBar');
    bar.style.transition = 'none'; bar.style.width = '0%';
    setTimeout(() => {
        bar.style.transition = `width ${userSettings.previewTime}s linear`;
        bar.style.width = '100%';
    }, 50);

    clearTimeout(pt);
    pt = setTimeout(() => {
        currentIdx++;
        nextPreview();
    }, userSettings.previewTime * 1000);
}

// ============================================================
// [2. Recall Phase]
// ============================================================
window.startDump = function() {
    if(!currentSession || currentSession.length === 0) return myAlert("학습 데이터 없음");

    saveSession();
    showPage('dump');
    document.onkeyup = null;
    window.speechSynthesis.cancel();

    document.getElementById('phaseTag').innerText = "2. RECALL";
    document.getElementById('wordArea').style.display = 'none';
    document.getElementById('inputArea').style.display = 'block';
    document.getElementById('pBarWrap').style.display = 'none';

    resetInputUI();
};

function resetInputUI() {
    const fMsg = document.getElementById('feedbackMsg');
    // 2단계라면, "단어와 뜻을 입력하세요" 메시지 뒤에 현재 맞춘 단어 수 표시, 예시) 15개중 7개 맞춤 -> "단어와 뜻을 입력하세요 (7/15)"
    fMsg.innerText = "단어와 뜻을 입력하세요" + (curPhase === 'dump' ? ` (${recalledWords.length}/${recalledWords.length + currentSession.length})` : "");
    fMsg.style.color = "var(--text)";

    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');
    wIn.value = ""; mIn.value = "";
    wIn.className = "input-box"; mIn.className = "input-box";
    wIn.readOnly = false; mIn.placeholder = "뜻 입력";

    document.getElementById('giveUpBtn').style.display = 'block';
    const btn = document.getElementById('actionBtn');
    btn.innerHTML = '확인 <span class="pc-hint">(Enter)</span>';
    btn.disabled = false;
    btn.onclick = handleDump;

    wIn.onkeyup = (e) => { if(e.key === 'Enter') mIn.focus(); };
    mIn.onkeyup = (e) => { if(e.key === 'Enter') handleDump(); };
    wIn.focus();
}

async function handleDump() {
    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');
    const inputWord = wIn.value.trim();
    const inputMean = mIn.value.trim();

    // 세션에서 입력 단어 찾기 (대소문자/공백 무시)
    const targetIndex = currentSession.findIndex(
        w => w.word.replaceAll(" ", "").toLowerCase() === inputWord.replaceAll(" ", "").toLowerCase()
    );

    if(targetIndex === -1) {
        updateFeedback("없는 단어입니다.", "wrong");
        setTimeout(() => resetInputUI(), 600);
        return;
    }

    const target = currentSession[targetIndex];

    updateFeedback("AI 채점 중...", "processing");
    document.getElementById('actionBtn').disabled = true;
    const isCorrect = await checkAI(inputMean, target.mean, target.word);
    document.getElementById('actionBtn').disabled = false;

    if(isCorrect) {
        updateFeedback(`정답! ${target.word} : ${target.mean}`, "correct");
        recalledWords.push(target);
        currentSession.splice(targetIndex, 1); // 세션에서 제거
        saveSession();
        setTimeout(() => resetInputUI(), 1200);
    } else {
        updateFeedback(`틀렸습니다. 정답: ${target.mean}`, "wrong");
        correctionQueue.push(target);
        currentSession.splice(targetIndex, 1); // 세션에서 제거
        saveSession();
        setTimeout(() => resetInputUI(), 2000);
    }

    // 세션이 비면 수정 단계로 이동
    if(currentSession.length === 0) startCorrectionPhase();
}

// ============================================================
// [3. Correction Phase]
// ============================================================
function startCorrectionPhase() {
    document.onkeyup = null;

    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');
    wIn.onkeyup = null;
    mIn.onkeyup = null;

    saveSession();
    resetInputUI();
    document.getElementById('giveUpBtn').style.display = 'none';
    correctionIdx = 0;
    if(correctionQueue.length === 0) {
        completeSession();
        return;
    }
    processCorrectionItem();
}

function processCorrectionItem() {
    saveSession();
    if(correctionIdx >= correctionQueue.length) {
        if(retryQueue.length > 0) {
            correctionQueue = [...retryQueue];
            retryQueue = [];
            correctionIdx = 0;
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
    showPage('correction_view');

    document.getElementById('phaseTag').innerText = `3. RE-LEARN (${correctionIdx + 1}/${correctionQueue.length})`;
    document.getElementById('wordArea').style.display = 'block';
    document.getElementById('pBarWrap').style.display = 'block';
    document.getElementById('inputArea').style.display = 'none';

    document.getElementById('mainWord').innerText = correctionTarget.word;
    document.getElementById('mainMean').innerText = correctionTarget.mean;
    playTTS(correctionTarget.word);

    const bar = document.getElementById('pBar');
    bar.style.transition = 'none'; bar.style.width = '0%';
    setTimeout(() => {
        bar.style.transition = `width ${userSettings.reLearnTime}s linear`;
        bar.style.width = '100%';
    }, 50);

    const btn = document.getElementById('actionBtn');
    btn.innerText = "암기 완료 (테스트)";
    btn.disabled = false;
    btn.onclick = showCorrectionInput;

    clearTimeout(pt);
    pt = setTimeout(showCorrectionInput, userSettings.reLearnTime * 1000);

    document.onkeyup = (e) => {
        if(curPhase === 'correction_view' && (e.code === 'Space' || e.code === 'Enter')) showCorrectionInput();
    };
}

function showCorrectionInput() {
    clearTimeout(pt);

    // 🔴 이전 단계 입력 이벤트 완전 제거
    const wIn = document.getElementById('inWord');
    const mIn = document.getElementById('inMean');
    wIn.onkeyup = null;
    mIn.onkeyup = null;

    document.onkeyup = null;

    curPhase = 'correction_test';
    document.getElementById('phaseTag').innerText = `3. RE-TEST (${correctionIdx + 1}/${correctionQueue.length})`;

    document.getElementById('wordArea').style.display = 'none';
    document.getElementById('pBarWrap').style.display = 'none';
    document.getElementById('inputArea').style.display = 'block';

    wIn.value = correctionTarget.word;
    wIn.readOnly = true;
    mIn.value = "";
    mIn.className = "input-box";
    mIn.placeholder = "뜻 입력";
    mIn.focus();

    const btn = document.getElementById('actionBtn');
    btn.innerText = "확인";
    btn.onclick = checkCorrectionAnswer;

    document.onkeyup = (e) => { if(e.code === 'Enter') checkCorrectionAnswer(); };
}

async function checkCorrectionAnswer() {
    document.onkeyup = null;
    document.getElementById('actionBtn').disabled = true;

    const input = document.getElementById('inMean').value.trim();
    updateFeedback("채점 중...", "processing");

    const isCorrect = await checkAI(input, correctionTarget.mean, correctionTarget.word);

    if(isCorrect) {
        updateFeedback(`정답! ${correctionTarget.word} : ${correctionTarget.mean}`, "correct");
        saveSession();
        setTimeout(() => resetInputUI(), 1200);

    } else {
        updateFeedback(`틀렸습니다. 정답: ${correctionTarget.mean}`, "wrong");
        retryQueue.push(correctionTarget);
        saveSession();
        setTimeout(() => resetInputUI(), 2000);
    }

    correctionIdx++;
    setTimeout(processCorrectionItem, isCorrect ? 1500 : 2500);
}

// ============================================================
// [4. Completion]
// ============================================================
async function completeSession() {
    myAlert("학습 완료! 🎉");
    localStorage.removeItem('wow_session');
    if(sessionType === 'daily' && auth.currentUser) {
        await db.ref(`users/${auth.currentUser.uid}/daily`).update({ finished: true });
        dailyStatus.finished = true;
        dailyStatus.date = new Date().toLocaleDateString();
    }
    loadData();
    showPage('page-home');
}
