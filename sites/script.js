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

async function fetchBusData() {
    const url = "http://bus.shibaura-it.ac.jp/db/bus_data.json";
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`ネットワーク応答が良くありません: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("データの取得に失敗しました:", error);
        return null;
    }
}

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

function getNextTimes(currentTime, schedule) {
    const nextBuses = [];
    const nextTrains = [];

    schedule.forEach(entry => {
        if (entry['time'] && /^\d+$/.test(entry['time'])) {
            const busHour = parseInt(entry['time'], 10);
            if (busHour < currentTime.getHours()) {
                // 現在の時間より前のバス時刻は無視
                return;
            }

            // バスの処理
            const busRight = entry['bus_right'];
            if (busRight) {
                const busTimes = busRight['num1'] ? busRight['num1'].split('.') : [];
                const memo1 = busRight['memo1'] || "";
                const memo2 = busRight['memo2'] || "";
                const isTemporarySchedule = memo1.includes('適時運行') || memo2.includes('適時運行');

                busTimes.forEach(busTime => {
                    if (busTime.match(/^\d+$/) || isTemporarySchedule) {
                        let busMinute;
                        if (busTime.match(/^\d+$/)) {
                            busMinute = parseInt(busTime, 10);
                        } else {
                            // 適時運行の場合、現在の分を使用
                            busMinute = currentTime.getMinutes();
                        }

                        const nextBus = new Date(currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate(), busHour, busMinute);
                        const minutesUntilNextBus = (nextBus - currentTime) / 60000;

                        if (minutesUntilNextBus >= 0) { // 過去のバス時刻を除外
                            nextBuses.push({ time: nextBus, minutes: minutesUntilNextBus, isTemporary: isTemporarySchedule });
                        }
                    }
                });
            }

            // 電車の処理
            const trainTimes = parseTrainTimes(entry, 'train_right');
            trainTimes.forEach(train => {
                const trainTime = new Date(currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate(), busHour, train.minute);
                const minutesUntilNextTrain = (trainTime - currentTime) / 60000;
                if (minutesUntilNextTrain >= 0) { // 過去の電車時刻を除外
                    nextTrains.push({ time: trainTime, destination: train.destination });
                }
            });
        }
    });

    // ソートして次のバスと電車を取得
    nextBuses.sort((a, b) => a.time - b.time);
    nextTrains.sort((a, b) => a.time - b.time);

    return { nextBuses, nextTrains };
}

function findNextTrain(arrivalTime, trainTimes) {
    for (const train of trainTimes) {
        if (train.time > arrivalTime) {
            return train;
        }
    }
    return null;
}

function generateMessage(locationName, times, nextBuses, trainTimes) {
    if (nextBuses.length === 0) {
        return `${locationName}: 本日のバスはもうありません。`;
    }

    const nextBus = nextBuses[0];
    const walkTime = times.walk;
    const runTime = times.run;
    let message = "";
    let arrivalTime;

    if (nextBus.isTemporary) {
        message = "この時間は適時運行です";
        arrivalTime = new Date(Date.now() + (walkTime + 13) * 60000);
    } else {
        const walkTimeLeft = nextBus.minutes - walkTime;
        if (walkTimeLeft >= 3) {
            message = "余裕をもって移動できます";
        } else if (walkTimeLeft >= 1) {
            message = "すぐ出発すれば間に合います";
        } else {
            const runTimeLeft = nextBus.minutes - runTime;
            if (runTimeLeft >= 0.5) {
                message = "急げば間に合います";
            } else if (nextBuses.length > 1) {
                const nextNextBus = nextBuses[1];
                const timeToNextNextBus = nextNextBus.minutes - walkTime;
                return `${locationName}: 次のバスをご利用ください（次は ${timeToNextNextBus.toFixed(1)} 分後です。）`;
            } else {
                return `${locationName}: 次のバスをご利用ください（次は本日中にありません）`;
            }
        }
        arrivalTime = new Date(nextBus.time.getTime() + 10 * 60000);
    }

    const nextTrain = findNextTrain(arrivalTime, trainTimes);
    let trainMessage = "";
    if (nextTrain) {
        const nextTrainStr = nextTrain.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const minutesUntilNextTrain = (nextTrain.time - arrivalTime) / 60000;
        if (minutesUntilNextTrain >= 60) {
            const hours = Math.floor(minutesUntilNextTrain / 60);
            const minutes = Math.floor(minutesUntilNextTrain % 60);
            trainMessage = `次の上り電車は ${nextTrainStr} 行き先: ${nextTrain.destination} で、予想到着時間は ${hours} 時間 ${minutes} 分後です。`;
        } else {
            trainMessage = `次の上り電車は ${nextTrainStr} 行き先: ${nextTrain.destination} で、予想到着時間は ${minutesUntilNextTrain.toFixed(1)} 分後です。`;
        }
    } else {
        trainMessage = "本日中に次の電車はありません。";
    }

    let finalMessage = "";
    if (nextBus.isTemporary) {
        finalMessage = `${locationName}: ${message}。${trainMessage}`;
    } else {
        finalMessage = `${locationName}: ${message}（バス停に到着してから ${nextBus.minutes.toFixed(1)} 分でバスが来ます）。${trainMessage}`;
    }

    if (nextBus.minutes > 20) {
        finalMessage += "（徒歩を推奨します）";
    }

    return finalMessage;
}

async function displayMessages(selectedLocation = "") {
    const data = await fetchBusData();
    if (!data) {
        document.getElementById('messages').innerText = "データの取得に失敗しました。";
        return;
    }

    const currentTime = new Date();
    const schedule = data['timesheet'][0]['list'];
    const { nextBuses, nextTrains } = getNextTimes(currentTime, schedule);

    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = "";

    // フィルタリング: 選択された出発地点に基づいて処理
    const locationsToDisplay = selectedLocation ? { [selectedLocation]: locations[selectedLocation] } : locations;

    for (const [locationName, times] of Object.entries(locationsToDisplay)) {
        const message = generateMessage(locationName, times, nextBuses, nextTrains);
        const messageDiv = document.createElement('div');
        messageDiv.className = 'location-message';

        const locationDiv = document.createElement('div');
        locationDiv.className = 'location-name';
        locationDiv.innerText = locationName;

        const messageTextDiv = document.createElement('div');
        messageTextDiv.className = 'message';
        messageTextDiv.innerText = message;

        messageDiv.appendChild(locationDiv);
        messageDiv.appendChild(messageTextDiv);
        messagesContainer.appendChild(messageDiv);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const departureSelect = document.getElementById('departure');

    // 初回表示: 全ての場所を表示
    displayMessages();

    // 選択が変更されたときにメッセージを更新
    departureSelect.addEventListener('change', (event) => {
        const selectedLocation = event.target.value;
        displayMessages(selectedLocation);
    });
});
