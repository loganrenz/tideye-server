-- CreateTable
CREATE TABLE "Vessel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mmsi" TEXT NOT NULL,
    "name" TEXT,
    "lastSeen" DATETIME NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PositionHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mmsi" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionHistory_mmsi_fkey" FOREIGN KEY ("mmsi") REFERENCES "Vessel" ("mmsi") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_mmsi_key" ON "Vessel"("mmsi");

-- CreateIndex
CREATE INDEX "PositionHistory_mmsi_timestamp_idx" ON "PositionHistory"("mmsi", "timestamp");
