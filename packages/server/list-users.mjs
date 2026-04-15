import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.user.findMany({ select: { email: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 })
  .then(users => { console.log(JSON.stringify(users, null, 2)); return p.$disconnect(); })
  .catch(err => { console.error(err.message); p.$disconnect(); process.exit(1); });
