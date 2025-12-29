// [ai.js] - AI 기능 전용 모듈
import { GoogleGenAI } from "https://esm.run/@google/genai";

// 1. AI 초기화 (app.js에 있는 GEMINI_KEY를 가져와서 씀)
// 주의: app.js가 먼저 로드되어 있어야 GEMINI_KEY를 찾을 수 있습니다.
let ai = null;
const inputField = document.getElementById('settingsApiKey');
const saveBtn = document.getElementById('saveApiKeyBtn');

saveBtn.addEventListener('click', async () => {
    const key = inputField.value.trim();
    if (!key) return myAlert("API 키를 입력하세요!");

    try {
        // 브라우저 환경에서는 import 대신 window.GoogleGenAI 필요
        ai = new GoogleGenAI({ apiKey: key });

        // 최소 ping 요청
        const result = await ai.models.countTokens({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        });

        if (result && result.totalTokens > 0) {
            window.GEMINI_KEY = key;
            localStorage.setItem("userApiKey", key);
            myAlert("API 키 정상 확인, 저장 완료!");
            document.getElementById('apiKeyPrompt').style.display = 'none';
        } else {
            myAlert("비정상적인 key입니다. 다시 확인해주세요.");
        }
    } catch (err) {
        console.error(err);
        let msg = "API 연결 실패";
        if (err.message.includes('API_KEY_INVALID')) msg += " - 키가 잘못되었습니다.";
        else if (err.message.includes('429')) msg += " - 사용량 제한 또는 유료 모델 필요.";
        else if (err.message.includes('INTERNAL')) msg += " - 서버 오류. 잠시 후 시도하세요.";
        myAlert(msg);
    }
});

window.saveUserApiKey = function() {
    const input = document.getElementById('popupApiKey').value.trim();
    if(!input) return myAlert("Gemini API 키를 입력하세요!");
    try {
        // 브라우저 환경에서는 import 대신 window.GoogleGenAI 필요
        ai = new GoogleGenAI({ apiKey: key });

        // 최소 ping 요청
        const result = ai.models.countTokens({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        });

        if (result && result.totalTokens > 0) {
            window.GEMINI_KEY = key;
            localStorage.setItem("userApiKey", key);
            myAlert("API 키 정상 확인, 저장 완료!");
            document.getElementById('apiKeyPrompt').style.display = 'none';
        } else {
            myAlert("비정상적인 key입니다. 다시 확인해주세요.");
        }
    } catch (err) {
        console.error(err);
        let msg = "API 연결 실패";
        if (err.message.includes('API_KEY_INVALID')) msg += " - 키가 잘못되었습니다.";
        else if (err.message.includes('429')) msg += " - 사용량 제한 또는 유료 모델 필요.";
        else if (err.message.includes('INTERNAL')) msg += " - 서버 오류. 잠시 후 시도하세요.";
        myAlert(msg);
    }
}

// 2. checkAI 함수 (window에 등록)
window.checkAI = async function(userMean, correctMean, word) {
    if (!userMean) return false;
    if (userMean.replace(/\s/g, '') === correctMean.replace(/\s/g, '')) return true;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Is "${userMean}" a correct meaning for the English word "${word}"? The primary definition is "${correctMean}". Reply ONLY with true or false.`,
            config: { temperature: 0, maxOutputTokens: 5 }
        });
        return response.text?.trim().toLowerCase() === 'true';
    } catch (e) {
        console.error("AI Check Error:", e);
        return correctMean.includes(userMean) || userMean.includes(correctMean);
    }
};

// 3. generateWithGemini 함수 (window에 등록)
window.generateWithGemini = async function(dbRef) {
    if (!window.GEMINI_KEY) return;

    try {
        const prompt = `You are a strict JSON helper. Task: Provide one interesting English etymology fact. Format: {"word": "EnglishWord", "desc": "Korean explanation under 100 chars"}. No markdown, just JSON. No extra text. Only JSON. Never add extra texts like "Here is the JSON you requested:".`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { temperature: 0.5, maxOutputTokens: 200, responseMimeType: "application/json" }
        });

        const text = response.text;

        console.log("Gemini Response Text:", text);

        const jsonMatch = text.match(/\{(?:[^{}]|"(?:\\.|[^"])*")*\}/);
        let result;
        if (jsonMatch) {
            try {
                result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn("Gemini JSON parse failed, fallback used", e);
                result = { word: "Serendipity", desc: "뜻밖의 행운." };
            }
        } else {
            result = { word: "Serendipity", desc: "뜻밖의 행운." };
        }


        // Firebase에 저장
        await dbRef.set({
            word: result.word,
            desc: result.desc,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });

        // UI 업데이트
        if (window.renderEtymology) window.renderEtymology(result.word, result.desc);

    } catch (e) {
        console.error("Gemini Error:", e);
        const fallback = { word: "Serendipity", desc: "뜻밖의 행운." };
        if (window.renderEtymology) window.renderEtymology(fallback.word, fallback.desc);
    }
};

console.log("AI 모듈 로드 완료!");