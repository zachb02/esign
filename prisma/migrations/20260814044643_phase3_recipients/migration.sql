-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "completedPdfKey" TEXT;

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "signerRoleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "signingToken" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldValue" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "textValue" TEXT,
    "checked" BOOLEAN,
    "signatureImageKey" TEXT,
    "dateValue" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_signingToken_key" ON "Recipient"("signingToken");

-- CreateIndex
CREATE UNIQUE INDEX "FieldValue_fieldId_key" ON "FieldValue"("fieldId");

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_signerRoleId_fkey" FOREIGN KEY ("signerRoleId") REFERENCES "SignerRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldValue" ADD CONSTRAINT "FieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldValue" ADD CONSTRAINT "FieldValue_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
