-- Every account that already had two-factor turned on was using an
-- authenticator app, because that was the only method there was. Say so
-- explicitly rather than leaving mfaMethod null, which would read as "has
-- a second factor, by no particular means".
UPDATE `User` SET `mfaMethod` = 'TOTP' WHERE `mfaEnabled` = 1 AND `mfaMethod` IS NULL;
