//大学内の主要な建物から何分後にバス停に出発すればよいかを確認できるwebアプリです!
//このwebアプリは芝浦工大の学バスオープンデータを使用しています!
//思いついて即興でAIに書かせたコードなので拙いです...ご了承ください!
//
//制作者 CY25061
const locations = {
    "生協": {"walk": 2, "run": 1},
    "記念館": {"walk": 3, "run": 2},
    "2号館": {"walk": 3.5, "run": 2.5},
    "3号館": {"walk": 3.5, "run": 2.5},
    "4号館": {"walk": 5, "run": 3},
    "5号館": {"walk": 5, "run": 3},
    "6号館": {"walk": 5.5, "run": 3.5},
    "図書館": {"walk": 5.5, "run": 3.5},
};

const destinationSettings = {
    "": "上野",
    "a": "逗子",
    "b": "大船",
    "c": "大宮",
    "d": "熱海",
    "e": "小田原",
    "f": "沼津",
    "g": "平塚",
    "h": "国府津",
    "i": "伊東",
    "j": "品川",
};

/**
 * CORSプロキシを使用してバスデータを取得します。
 * @returns {Promise<Object|null>} 取得したデータオブジェクト、またはnull
 */
async function fetchBusData() {
    const originalURL = "http://bus.shibaura-it.ac.jp/db/bus_data.json";
    const proxyURL = "https://api.allorigins.win/raw?url=" + encodeURIComponent(originalURL);
    const loader = document.getElementById('loader');
    loader.classList.remove('hidden'); // ローディングスピナーを表示

    try {
        const response = await fetch(proxyURL);
        if (!response.ok) {
            throw new Error(`ネットワーク応答が良くありません: ${response.statusText}`);
        }
        const data = await response.json();
        console.log("Fetched Data:", data); // デバッグ用
        return data;
    } catch (error) {
        console.error("データの取得に失敗しました:", error);
        return null;
    }
}

/**
 * 指定された方向の電車時刻を解析します。
 * @param {Object} entry - スケジュールのエントリ
 * @param {String} direction - "train_right"などの方向
 * @returns {Array} - 電車時刻のリスト
 */
function parseTrainTimes(entry, direction) {
    const trainTimes = [];
    ['num1', 'num2'].forEach(timeSet => {
        if (entry[direction] && entry[direction][timeSet]) {
            const trainData = entry[direction][timeSet].split('.');
            trainData.forEach(trainInfo => {
                if (trainInfo && /^\w\d{2}$/.test(trainInfo)) {
                    const minute = parseInt(trainInfo.slice(1, 3), 10);
                    const destinationMark = trainInfo.charAt(0);
                    const destination = destinationSettings[destinationMark] || "不明";
                    trainTimes.push({ minute, destination });
                }
            });
        }
    });
    return trainTimes;
}

/**
 * スケジュールから指定された時刻以降の次のバスを見つけます。
 * @param {Array} schedule - バスおよび電車のスケジュールリスト
 * @param {Date} arrivalTime - バス停に到着する時刻
 * @returns {Object|null} - 次のバスの情報、またはnull
 */
function findNextBus(schedule, arrivalTime) {
    let nextBus = null;

    schedule.forEach(entry => {
        if (entry['time'] && /^\d+$/.test(entry['time'])) {
            const busHour = parseInt(entry['time'], 10);
            const busRight = entry['bus_right'];
            if (busRight) {
                const busTimes = busRight['num1'] ? busRight['num1'].split('.') : [];
                const memo1 = busRight['memo1'] || "";
                const memo2 = busRight['memo2'] || "";
                const isTemporarySchedule = memo1.includes('適時運行') || memo2.includes('適時運行');

                busTimes.forEach(busTime => {
                    let busMinute;
                    if (isTemporarySchedule) {
                        busMinute = arrivalTime.getMinutes(); // 適時運行の場合、現在の分を使用
                    } else if (/^\d+$/.test(busTime)) {
                        busMinute = parseInt(busTime, 10);
                    } else {
                        return; // 無効な時刻フォーマット
                    }

                    const busDateTime = new Date(arrivalTime.getFullYear(), arrivalTime.getMonth(), arrivalTime.getDate(), busHour, busMinute);
                    if (busDateTime >= arrivalTime) {
                        if (!nextBus || busDateTime < nextBus.time) {
                            nextBus = {
                                time: busDateTime,
                                isTemporary: isTemporarySchedule
                            };
                        }
                    }
                });
            }
        }
    });

    return nextBus;
}

/**
 * スケジュールから指定された時刻以降の次の電車を見つけます。
 * @param {Array} trainTimes - 電車時刻のリスト
 * @param {Date} arrivalTime - 電車を待つ時刻
 * @returns {Object|null} - 次の電車の情報、またはnull
 */
function findNextTrain(trainTimes, arrivalTime) {
    let nextTrain = null;

    trainTimes.forEach(train => {
        const trainHour = parseInt(train.time, 10);
        const trainTime = new Date(arrivalTime.getFullYear(), arrivalTime.getMonth(), arrivalTime.getDate(), trainHour, train.minute);
        if (trainTime >= arrivalTime) {
            if (!nextTrain || trainTime < nextTrain.time) {
                nextTrain = {
                    time: trainTime,
                    destination: train.destination
                };
            }
        }
    });

    return nextTrain;
}

/**
 * 各地点ごとに適切なメッセージを生成します。
 * @param {String} locationName - 地点の名前
 * @param {Object} times - walkおよびrunの時間
 * @param {Array} schedule - スケジュールのリスト
 * @param {Array} allTrainTimes - 全電車時刻のリスト
 * @returns {String} - 生成されたメッセージ
 */
function generateMessage(locationName, times, schedule, allTrainTimes) {
    const currentTime = new Date();

    // 徒歩での到着時刻
    const arrivalTimeWalk = new Date(currentTime.getTime() + times.walk * 60000);
    console.log(`\n==== ${locationName} ====`);
    console.log(`Walk Time: ${times.walk}分, Run Time: ${times.run}分`);
    console.log(`Arrival Time Walk: ${arrivalTimeWalk}`);

    // 次のバスを見つける
    const nextBus = findNextBus(schedule, arrivalTimeWalk);
    console.log(`Next Bus: ${nextBus ? nextBus.time : 'なし'}, Is Temporary: ${nextBus ? nextBus.isTemporary : 'N/A'}`);

    if (!nextBus) {
        return `${locationName}: 本日のバスはもうありません。`;
    }

    let message = "";
    let arrivalTime; // 電車を待つ時刻

    if (nextBus.isTemporary) {
        message = `<span class="message-temporary">この時間は適時運行です</span>`;
        // 適時運行の場合、現在時刻 + walk_time + 13分後を到着時刻とする
        arrivalTime = new Date(currentTime.getTime() + (times.walk + 13) * 60000);
    } else {
        // バス待ち時間
        const walkTimeLeft = (nextBus.time - arrivalTimeWalk) / 60000;
        console.log(`Walk Time Left: ${walkTimeLeft}分`);

        if (walkTimeLeft >= 3) {
            message = `<span class="message-leeway">余裕をもって移動できます</span>`;
        } else if (walkTimeLeft >= 1) {
            message = `<span class="message-soon">すぐ出発すれば間に合います</span>`;
        } else {
            // 走りで移動した場合の待ち時間
            const runArrivalTime = new Date(currentTime.getTime() + times.run * 60000);
            const runTimeLeft = (nextBus.time - runArrivalTime) / 60000;
            console.log(`Run Time Left: ${runTimeLeft}分`);

            if (runTimeLeft >= 0.5) {
                message = `<span class="message-hurry">急げば間に合います</span>`;
            } else {
                // 次のバスを探す
                const nextBusAfter = findNextBus(schedule, new Date(nextBus.time.getTime() + 60000)); // 1分後のバス
                if (nextBusAfter) {
                    const timeToNextNextBus = (nextBusAfter.time - arrivalTimeWalk) / 60000;
                    if (timeToNextNextBus >= 0) {
                        message = `${locationName}: 次のバスをご利用ください（次は ${timeToNextNextBus.toFixed(1)} 分後です。）`;
                    } else {
                        message = `${locationName}: 次のバスをご利用ください（次は本日中にありません）`;
                    }
                } else {
                    message = `${locationName}: 次のバスをご利用ください（次は本日中にありません）`;
                }
                return message;
            }
        }

        // バス到着後10分を待ち時間として電車の到着時刻を計算
        arrivalTime = new Date(nextBus.time.getTime() + 10 * 60000);
    }

    console.log(`Arrival Time for Train: ${arrivalTime}`);

    // 次の電車を見つける
    const nextTrain = findNextTrain(allTrainTimes, arrivalTime);
    console.log(`Next Train: ${nextTrain ? `${nextTrain.time} 行き先: ${nextTrain.destination}` : 'なし'}`);

    let trainMessage = "";
    if (nextTrain) {
        const hours = nextTrain.time.getHours().toString().padStart(2, '0');
        const minutes = nextTrain.time.getMinutes().toString().padStart(2, '0');
        const minutesUntilNextTrain = (nextTrain.time - arrivalTime) / 60000;

        if (minutesUntilNextTrain >= 60) {
            const waitHours = Math.floor(minutesUntilNextTrain / 60);
            const waitMinutes = Math.floor(minutesUntilNextTrain % 60);
            trainMessage = `次の上り電車は ${hours}:${minutes} 行き先: ${nextTrain.destination} で、予想到着時間は ${waitHours} 時間 ${waitMinutes} 分後です。`;
        } else {
            trainMessage = `次の上り電車は ${hours}:${minutes} 行き先: ${nextTrain.destination} で、予想到着時間は ${minutesUntilNextTrain.toFixed(1)} 分後です。`;
        }
    } else {
        trainMessage = "本日中に次の電車はありません。";
    }

    // 最終メッセージの生成
    let finalMessage = "";
    if (nextBus.isTemporary) {
        finalMessage = `${locationName}: ${message}。${trainMessage}`;
    } else {
        const waitMinutes = (nextBus.time - arrivalTimeWalk) / 60000;
        finalMessage = `${locationName}: ${message}（バス停に到着してから ${(waitMinutes).toFixed(1)} 分でバスが来ます）。${trainMessage}`;
    }

    if ((nextBus.time - arrivalTimeWalk) / 60000 > 20) {
        finalMessage += "（徒歩を推奨します）";
    }

    console.log(`Final Message: ${finalMessage}`);
    return finalMessage;
}

/**
 * メッセージを表示します。
 * @param {String} selectedLocation - 選択された出発地点
 */
async function displayMessages(selectedLocation = "") {
    const loader = document.getElementById('loader');
    loader.classList.remove('hidden'); // ローディングスピナーを表示

    const data = await fetchBusData();
    if (!data) {
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerText = "データの取得に失敗しました。";
        loader.classList.add('hidden');
        return;
    }

    const currentTime = new Date();
    const schedule = data['timesheet'][0]['list'];
    const allTrainTimes = [];

    // 全電車時刻を収集
    schedule.forEach(entry => {
        if (entry['train_right']) {
            const trainTimes = parseTrainTimes(entry, 'train_right');
            trainTimes.forEach(train => {
                allTrainTimes.push({
                    time: entry['time'], // 時間部分
                    minute: train.minute,
                    destination: train.destination
                });
            });
        }
    });

    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = "";

    // 選択された出発地点に基づいて処理
    const locationsToDisplay = { [selectedLocation]: locations[selectedLocation] };

    for (const [locationName, times] of Object.entries(locationsToDisplay)) {
        const message = generateMessage(locationName, times, schedule, allTrainTimes);
        const messageDiv = document.createElement('div');
        messageDiv.className = 'location-message';

        const locationDiv = document.createElement('div');
        locationDiv.className = 'location-name';
        locationDiv.innerText = locationName;

        const messageTextDiv = document.createElement('div');
        messageTextDiv.className = 'message';
        messageTextDiv.innerHTML = message; // innerHTMLに変更

        messageDiv.appendChild(locationDiv);
        messageDiv.appendChild(messageTextDiv);
        messagesContainer.appendChild(messageDiv);

        // アニメーションクラスの追加
        setTimeout(() => {
            messageDiv.classList.add('show');
        }, 100); // 少し遅延させることでスムーズなアニメーションを実現
    }

    loader.classList.add('hidden'); // ローディングスピナーを非表示
}

// 初期表示と20秒ごとの更新
document.addEventListener('DOMContentLoaded', () => {
    const departureSelect = document.getElementById('departure');

    // 初回表示: デフォルトの選択地点を表示
    const initialLocation = departureSelect.value;
    displayMessages(initialLocation);

    // 選択が変更されたときにメッセージを更新
    departureSelect.addEventListener('change', (event) => {
        const selectedLocation = event.target.value;
        displayMessages(selectedLocation);
    });

    // 20秒ごとにデータを更新
    setInterval(() => {
        const selectedLocation = departureSelect.value;
        displayMessages(selectedLocation);
    }, 20000); // 20,000ミリ秒 = 20秒
});
