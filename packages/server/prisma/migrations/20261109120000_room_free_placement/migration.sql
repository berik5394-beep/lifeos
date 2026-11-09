-- Свободная расстановка в комнате робота: предмет на поверхности (x, y — доли),
-- ячейки остаются только у отделки (finish-*).
ALTER TABLE "RoomItem" ADD COLUMN "surface" TEXT;

UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.218, "y" = 0.27, "slot" = NULL WHERE "slot" = 'floor-back-left';
UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.5, "y" = 0.24, "slot" = NULL WHERE "slot" = 'floor-back-center';
UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.782, "y" = 0.27, "slot" = NULL WHERE "slot" = 'floor-back-right';
UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.116, "y" = 0.581, "slot" = NULL WHERE "slot" = 'floor-mid-left';
UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.884, "y" = 0.581, "slot" = NULL WHERE "slot" = 'floor-mid-right';
UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.093, "y" = 0.85, "slot" = NULL WHERE "slot" = 'floor-front-left';
UPDATE "RoomItem" SET "surface" = 'floor', "x" = 0.907, "y" = 0.85, "slot" = NULL WHERE "slot" = 'floor-front-right';
UPDATE "RoomItem" SET "surface" = 'wall-left', "x" = 0.401, "y" = 0.497, "slot" = NULL WHERE "slot" = 'wall-left';
UPDATE "RoomItem" SET "surface" = 'wall-back', "x" = 0.5, "y" = 0.167, "slot" = NULL WHERE "slot" = 'wall-center';
UPDATE "RoomItem" SET "surface" = 'wall-right', "x" = 0.599, "y" = 0.497, "slot" = NULL WHERE "slot" = 'wall-right';
