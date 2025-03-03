import fetch from 'node-fetch';
import crypto from "crypto";
import chalk from "chalk";
import fs from "fs";
import { HttpsProxyAgent } from 'https-proxy-agent';
import moment from 'moment-timezone';
import yargs from 'yargs';
import Table from 'cli-table3';
const l = console.log;
const e = process.exit;

// اول اینو بزنید راهنما رو ببینید
// node bot.mjs --help

// حداقل و حداکثر تاخیر بر حسب ثانیه
const delayMin = 5;
const delayMax = 10;

// آرگومان‌های ورودی
const args = yargs(process.argv.slice(2))
    .usage('\nRobot for solving the Mofid Securities Treasure Nowruz Contest')
    .usage('by t.me/BotSorati x.com/NabiKAZ')
    .usage('https://github.com/NabiKAZ/bot-treasure-mofid\n')
    .usage('Usage: node $0 <command> [options]')
    .options({
        'action': {
            alias: 'a',
            describe: 'Action ("info" or default for main operation).',
            type: 'string',
        },
        'user': {
            alias: 'u',
            describe: 'User ID(s), comma-separated (default: all users).',
            type: 'string',
        },
    })
    .example([
        ['node $0 list'],
    ])
    .help()
    .alias('h', 'help')
    .version(false)
    .parse();

// لیست پروکسی‌ها
const proxies = [
    { id: 'local', url: 'socks5://127.0.0.1:10808' },
    // { id: 'proxy1', url: 'http://user:pass@ip:port' },
];

// لیست یوزرها
let users = [
    { id: 'user1', proxy: getProxy('local') }, // استفاده از پروکسی آیدی local
    // { id: 'user2', proxy: false }, // بدون پروکسی
    // { id: 'user3' }, // استفاده از پروکسی چرخشی
];

// گرفتن روز جاری
const day = getDay();

// یوزرهای ورودی میتونن با کاما جدا بشن وگرنه همه استفاده میشن
if (args.user) {
    const userIds = args.user.split(',');
    users = users.filter(user => userIds.includes(user.id));
    if (users.length === 0) {
        console.log(chalk.redBright('No users found.'));
        process.exit();
    }
}

// تنظیم پروکسی برای کاربران
for (let user of users) {
    let agent = null;
    if (user.proxy) { // اگر پروکسی داشت
        agent = new HttpsProxyAgent(user.proxy.url);
    } else if (user.proxy !== false) { // اگر پروکسی مقدار نداشت و false هم نبود
        user.proxy = getProxy(); // به شکل چرخشی یک پروکسی انتخاب بشه
        agent = new HttpsProxyAgent(user.proxy.url);
    }
    user.agent = agent;
}

// خوندن فایل توکن‌های لاگین کاربران
let tokens = fs.readFileSync('./tokens.json', 'utf8');
tokens = JSON.parse(tokens);

// تخصیص توکن‌های لاگین به کاربران
users = users.map(user => {
    const token = tokens.find(t => t.name === user.id && t.enable === true);
    if (token) {
        user.token = token.api_token;
    } else {
        user.token = null;
    }
    return user;
});

// نمایش جدول رتبه‌بندی و امتیازات با پردازش موازی
if (args.action === 'info') {

    // ساخت و تنظیم عنوان جدول
    const heads = ['#', 'ID', 'Points', 'Rank'];
    const table = new Table({
        head: heads,
        style: { head: ['cyan'] }
    });

    process.stdout.write('Loading');

    const userScores = await Promise.all(users.map(async (user, index) => {
        try {
            // گرفتن رتبه و امتیازان کاربران
            const score = await getScores(user);

            // تولید هر ردیف جدول
            const rows = {
                id: user.id,
                points: score.point,
                rank: score.rank
            };

            // نمایش پیشرفت کار
            process.stdout.write('.');
            return rows;

        } catch (error) {
            // مدیریت خطا
            return {
                id: user?.id ?? '',
                points: 0,
                rank: 'Error',
                error: error.message
            };
        }
    }));

    // مرتب‌سازی بر اساس امتیازان از زیاد به کم
    const sortedScores = userScores.sort((a, b) => b.points - a.points);

    // ثبت هر ردیف جدول
    sortedScores.forEach((userScore, index) => {
        if (userScore.error) {
            table.push([index + 1, userScore.id, { content: chalk.redBright(`Error: ${userScore.error}`), colSpan: 2 }]);
        } else {
            table.push([index + 1, userScore.id, userScore?.points?.toLocaleString(), userScore?.rank?.toLocaleString()]);
        }
    });

    // نمایش جدول
    console.log('');
    console.log(table.toString());

    process.exit();
}

// گرفتن همه کمپین‌ها
let res = await getAllCampaigns(users[0]);
let referenceCampaignIds = Object.values(res?.data || {}).map(item => item.id);

// !و عشق آغاز گردید
console.log(chalk.gray(`Robot for solving the Mofid Securities Treasure Nowruz Contest`));
console.log(chalk.gray(`By t.me/BotSorati x.com/NabiKAZ`));
console.log(chalk.gray(`https://github.com/NabiKAZ/bot-treasure-mofid`));
console.log('--------------------------------------------------');
console.log(`For Day: ${chalk.cyanBright(day)}`);
console.log(`Count campaign IDs: ${chalk.cyanBright(referenceCampaignIds.length)}`);
console.log(`Delay min: ${chalk.cyanBright(delayMin)} , max: ${chalk.cyanBright(delayMax)}`);
console.log('==================================================');

// یکی یکی برای کاربرا میزنیم
for (let [index, user] of users.entries()) {

    // اگر توکن نداشت ازش رد شو
    if (!user.token) {
        console.log(`${index + 1}/${users.length} > User ${chalk.cyanBright(user.id)}: ${chalk.yellowBright(`It doesn't have a token.`)}`);
        continue;
    }

    // گرفتن یوزرآیدی کاربر
    let userId = await getUserId(user);

    // نمایش لاگ شروع
    console.log(`${index + 1}/${users.length} > User ${chalk.cyanBright(user.id)}`, userId, user.token.substring(0, 30) + '...', user.proxy.id);

    // گرفتن کمپین‌های مشارکت شده
    let res = await getCampaigns(user);

    // کمپین‌های کاربر برای روز جاری هستند یا نه
    let isValid = Object.values(res.data).every(item => getDay(item.createTime) === day);
    console.log('Valid day:', isValid);

    let userCampaignIds = [];
    if (isValid) { // اگر کمپین‌ها برای روز جاری بودند آیدیهاشون رو برمیداریم
        console.log(chalk.blueBright('Campaigns match. Collecting IDs...'));
        userCampaignIds = Object.values(res.data).map(item => item.campaignActionId);
    } else { // وگرنه روز جدیده و کمپینی زده نشده
        console.log(chalk.yellowBright('Day mismatch. No IDs collected.'));
    }

    // کمپین‌هایی که زده نشدند رو پیدا میکنیم
    let incompleteIds = referenceCampaignIds.filter(id => !userCampaignIds.includes(id));

    // ترتیب کمپین‌ها رو تصادفی میکنیم
    incompleteIds = incompleteIds.sort(() => Math.random() - 0.5);

    // تعداد کمپین‌ها
    const incompleteCount = incompleteIds.length;
    console.log(`Count incomplete IDs: ${chalk.cyanBright(incompleteCount)}`);

    // اگر کمپینی باقی بود شروع کن زدن همه
    if (incompleteCount > 0) {
        for (let [index, id] of incompleteIds.entries()) {

            // شرکت در کمپین
            let res = await callCampaign(user, id, day, userId);

            if (res.isSuccessfull) { // اگر موفق بود
                console.log(`${index + 1}/${incompleteCount} > Campaign id: ${id} ... ${chalk.greenBright('Success:')} ${chalk.cyanBright('+' + res.data)}`);
            } else { // اگر خطا خورد
                console.log(`${index + 1}/${incompleteCount} > Campaign id: ${id} ... ${chalk.redBright('Error:')} ${res.messageDesc}`);
            }

            // یک تاخیر تصادفی میدیم که مثلاً نفهمن روباتیم!
            await sleep(randomNumber(delayMin, delayMax) * 1000);
        }
    } else {
        console.log(chalk.yellowBright(`Not found any campaign id.`));
    }

    // در پایان رتبه و امتیاز کاربر رو چاپ میکنیم
    const score = await getScores(user);
    console.log(`${chalk.magentaBright('Results:')} Rank: ${chalk.greenBright(score.rank.toLocaleString())} | Score: ${chalk.greenBright(score.point.toLocaleString())}`);

    console.log('');
};

// تابع پایه ارسال درخواست‌ها
async function fetchAPI(url, user, method = "GET", body = null) {
    const baseUrl = "https://api2.mofidonline.com/Web/V3";
    const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,fa;q=0.8,de;q=0.7",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "pragma": "no-cache",
        "sec-ch-ua": "\"Not(A:Brand\";v=\"99\", \"Google Chrome\";v=\"133\", \"Chromium\";v=\"133\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "x-appname": "titan",
        "referrer": "https://t.mofidonline.com/",
        "referrerPolicy": "strict-origin-when-cross-origin"
    };
    try {
        const res = await fetch(`${baseUrl}${url}`, {
            method,
            headers: { ...headers, authorization: "Bearer " + user.token },
            body: body ? JSON.stringify(body) : null,
            agent: user.agent
        });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error(chalk.redBright(`Error in ${url}: ${error.message}`));
    }
}

// شرکت در یک کمپین
async function callCampaign(user, id, day, userId) {
    const encryptedText = encryptMofid(`${userId}|${day}|${id}`);
    return fetchAPI(`/CampaignActionLog/${id}`, user, "POST", { EncryptedText: encryptedText });
}

// کمپین‌های مشارکت شده توسط کاربر در روز جاری رو برمی‌گردونه
async function getCampaigns(user) {
    return fetchAPI("/CampaignActionLog/TodayActions", user);
}

// تمامی کمپین‌های موجود رو برمی‌گردونه
async function getAllCampaigns(user) {
    return fetchAPI("/CampaignAction", user);
}

// یوزر آیدی در سایت رو برمی‌گردونه
async function getUserId(user) {
    const res = await fetchAPI("/Authenticate/GetUserProfile", user);
    return res?.data?.customerIsin;
}

// رتبه و امتیاز کاربر رو برمی‌گردونه
async function getScores(user) {
    const res = await fetchAPI("/CampaignActionLog/Scoreboard", user);
    return res?.data?.find(u => u.targetUser === true);
}

// ایجاد وقفه
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// تولید عدد تصادفی بین بازه مشخص
function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

// انکریپت پیام با کلید مشخص
function encryptMofid(text) {
    return encryptAES_ECB(text, "mfCompetitionKey");
}

// انکریپت پیام
function encryptAES_ECB(text, key, prefix = "", suffix = "") {
    // حذف فضاهای اضافی از مقدار ورودی و کلید
    let trimmedText = text.trim();
    let trimmedKey = key.trim();

    // تنظیم طول کلید به 16، 24 یا 32 بایت (AES-128, AES-192, AES-256)
    let keyBuffer = Buffer.alloc(16, trimmedKey); // AES-128
    if (trimmedKey.length > 16) keyBuffer = Buffer.alloc(24, trimmedKey); // AES-192
    if (trimmedKey.length > 24) keyBuffer = Buffer.alloc(32, trimmedKey); // AES-256

    // اضافه کردن پدینگ PKCS7 برای هم‌سطح شدن طول داده
    let blockSize = 16;
    let textBuffer = Buffer.from(trimmedText, "utf8");
    let padLength = blockSize - (textBuffer.length % blockSize);
    let paddedText = Buffer.concat([textBuffer, Buffer.alloc(padLength, padLength)]);

    // رمزگذاری با AES-ECB
    let cipher = crypto.createCipheriv("aes-128-ecb", keyBuffer, null);
    cipher.setAutoPadding(false); // چون پدینگ را دستی اضافه کردیم

    let encrypted = Buffer.concat([cipher.update(paddedText), cipher.final()]);
    let encryptedBase64 = encrypted.toString("base64");

    // اضافه کردن پیشوند و پسوند (در صورت نیاز)
    return `${prefix}${suffix}${encryptedBase64}`;
}

// گرفتن پروکسی به شکل چرخشی یا از روی آیدی خاص
function getProxy(id) {
    if (id) {
        const proxy = proxies.find(proxy => proxy.id === id);
        if (!proxy) {
            console.log(chalk.yellowBright(`Warning: Proxy not found.`));
            return false;
        }
        return proxy;
    } else {
        if (typeof getProxy.index === 'undefined') getProxy.index = 0;
        let proxy = proxies[getProxy.index];
        getProxy.index++;
        if (getProxy.index >= proxies.length) getProxy.index = 0;
        return proxy;
    }
}

// گرفتن روز جاری میلادی به وقت ایران
function getDay(dateString = null) {
    return moment.tz(dateString || moment(), "Asia/Tehran").format("D");
}
