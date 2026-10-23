const fs = require("fs");
const https = require("https");
const path = require("path");
const Handlebars = require("handlebars");
const config = require("./config");

const root = __dirname;
const dist = path.join(root, "dist");

function csvUrl() {
    return "https://docs.google.com/spreadsheets/d/" + config.id + "/export?format=csv";
}

/** Minimal RFC4180 CSV parser (handles quoted fields with commas/newlines). */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let i = 0;
    let inQuotes = false;

    while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += c;
            i++;
            continue;
        }
        if (c === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (c === ",") {
            row.push(field);
            field = "";
            i++;
            continue;
        }
        if (c === "\r") {
            i++;
            continue;
        }
        if (c === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
            i++;
            continue;
        }
        field += c;
        i++;
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function rowsToObjects(rows) {
    if (!rows.length) {
        return [];
    }
    const headers = rows[0].map(function(h) {
        return (h || "").trim();
    });
    const items = [];
    for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!cells || cells.every(function(c) { return !(c || "").trim(); })) {
            continue;
        }
        const item = {};
        for (let c = 0; c < headers.length; c++) {
            const key = headers[c];
            if (!key) {
                continue;
            }
            item[key] = cells[c] != null ? String(cells[c]).trim() : "";
        }
        items.push(item);
    }
    return items;
}

function fetchCsv(url) {
    return new Promise(function(resolve, reject) {
        const req = https.get(url, {
            headers: { "User-Agent": "sjm/1.0" }
        }, function(res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                fetchCsv(res.headers.location).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error("CSV export HTTP " + res.statusCode));
                return;
            }
            const chunks = [];
            res.on("data", function(chunk) { chunks.push(chunk); });
            res.on("end", function() {
                resolve(Buffer.concat(chunks).toString("utf8"));
            });
        });
        req.on("error", reject);
        req.setTimeout(30000, function() {
            req.destroy(new Error("CSV export timed out"));
        });
    });
}

function buildFromItems(items) {
    const categories = {};
    const namesList = [];

    items.forEach(function(item) {
        if (item.rubriek) {
            item.rubriek = item.rubriek.split(",").map(function(r) {
                return r.trim();
            }).filter(Boolean);
        } else {
            item.rubriek = [];
        }
        item.url = item.YouTube || "";
        if (item.publiek === "1") {
            for (let i = 0; i < item.rubriek.length; i++) {
                const cat = item.rubriek[i];
                if (!(cat in categories)) {
                    categories[cat] = [];
                }
                categories[cat].push({
                    url: item.url,
                    name: item.woord
                });
            }
            if (item.woord) {
                namesList.push(item);
            }
        }
    });

    const ordered = {};
    Object.keys(categories).sort().forEach(function(key) {
        const catItems = categories[key];
        catItems.sort(function(a, b) {
            return (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0);
        });
        ordered[key] = catItems;
    });

    namesList.sort(function(a, b) {
        if (a.woord.toLowerCase() < b.woord.toLowerCase()) return -1;
        if (a.woord.toLowerCase() > b.woord.toLowerCase()) return 1;
        return 0;
    });

    return {
        categories: ordered,
        namesList: namesList
    };
}

function loadTemplates() {
    const dir = path.join(root, "templates");
    const partialsDir = path.join(dir, "partials");
    fs.readdirSync(partialsDir).forEach(function(file) {
        if (!file.endsWith(".hbs")) {
            return;
        }
        const name = path.basename(file, ".hbs");
        Handlebars.registerPartial(name, fs.readFileSync(path.join(partialsDir, file), "utf8"));
    });
    function compile(name) {
        return Handlebars.compile(fs.readFileSync(path.join(dir, name + ".hbs"), "utf8"));
    }
    return {
        index: compile("index"),
        gebaren: compile("gebaren"),
        categorie: compile("categorie"),
        offline: compile("offline")
    };
}

function writePage(rel, html) {
    const dest = path.join(dist, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, html);
}

function categoryDir(name) {
    if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) {
        throw new Error("Unsupported category name: " + JSON.stringify(name));
    }
    return name;
}

function main() {
    return fetchCsv(csvUrl()).then(function(text) {
        const built = buildFromItems(rowsToObjects(parseCsv(text)));
        const templates = loadTemplates();

        fs.rmSync(dist, { recursive: true, force: true });
        fs.mkdirSync(dist, { recursive: true });
        fs.cpSync(path.join(root, "public"), path.join(dist, "public"), { recursive: true });
        fs.copyFileSync(
            path.join(root, "public", "service-worker.js"),
            path.join(dist, "service-worker.js")
        );

        writePage("index.html", templates.index({ categories: built.categories }));
        writePage("gebaren/index.html", templates.gebaren({ list: built.namesList }));
        writePage("offline/index.html", templates.offline({}));

        Object.keys(built.categories).forEach(function(name) {
            const dir = categoryDir(name);
            writePage(
                path.join("categorie", dir, "index.html"),
                templates.categorie({ cat: built.categories[name] })
            );
        });

        const search = built.namesList.map(function(item) {
            return { woord: item.woord, url: item.url };
        });
        fs.writeFileSync(path.join(dist, "search.json"), JSON.stringify(search));

        console.log(
            "Built " + search.length + " gebaren and " +
            Object.keys(built.categories).length + " categories"
        );
    });
}

main().catch(function(err) {
    console.error(err.message || err);
    process.exit(1);
});
