# QC Report

## Summary

- `nhi_product_count`: 45038
- `ingredient_coverage_count`: 45034
- `ingredient_coverage_pct`: 99.99%
- `tfda_join_coverage_count`: 45008
- `tfda_join_coverage_pct`: 99.93%
- `atc_presence_count`: 45038
- `atc_presence_pct`: 100.00%
- `atc_join_coverage_count`: 43600
- `atc_join_coverage_pct`: 96.81%
- `all1_overlap_count`: 45038
- `all1_overlap_pct`: 100.00%
- `review_queue_count`: 44878

## Top TFDA Mismatch Examples

- `nhi_code=A000015421` `tfda_permit_no=衛署藥製字第000015號` `confidence=0` `status=pending`
  input: SULFAMETHOXAZOLE SODIUM 20 MG/ML
  tfda: SULFAMETHOXAZOLE SODIUM
- `nhi_code=A000015435` `tfda_permit_no=衛署藥製字第000015號` `confidence=0` `status=pending`
  input: SULFAMETHOXAZOLE SODIUM 20 MG/ML
  tfda: SULFAMETHOXAZOLE SODIUM
- `nhi_code=A000023100` `tfda_permit_no=衛署藥製字第000023號` `confidence=0` `status=pending`
  input: ISONIAZID 100 MG
  tfda: ISONIAZID
- `nhi_code=A000026157` `tfda_permit_no=衛署藥製字第000026號` `confidence=0` `status=pending`
  input: NIACINAMIDE (=NICOTINAMIDE) 20 MG/ML+FERRIC AMMONIUM CITRATE .55 MG/ML+PANTHENOL D- 5 MG/ML+RIBOFLAVIN (=VIT B2) 3 MG/ML+PYRIDOXINE HCL 1 MG/ML+CYANOCOBALAMIN (=VIT B12) 5 MCG/ML
  tfda: VITAMIN A (PALMITATE) ;; NIACINAMIDE (NICOTINAMIDE) ;; CHOLECALCIFEROL ( EQ TO VIT D3) ( EQ TO VITAMIN D3) ;; RIBOFLAVIN (VIT B2) ;; ASCORBIC ACID (VIT C) ;; PANTHENOL D- (EQ TO D-PANTHENOL) ;; FERRIC AMMONIUM CITRATE ;; CYANOCOBALAMIN (VIT B12) ;; THIAMINE HYDROCHLORIDE ;; PYRIDOXINE HCL
- `nhi_code=A000058172` `tfda_permit_no=衛署藥製字第000058號` `confidence=0` `status=pending`
  input: DICYCLOMINE HCL 5 MG/GM+ALUMINUM HYDROXIDE (=ALUMINA HYDRATED) 400 MG/GM+MAGNESIUM OXIDE 200 MG/GM
  tfda: MAGNESIUM OXIDE ;; ALUMINUM HYDROXIDE (ALUMINA HYDRATED) ;; DICYCLOMINE HCL
- `nhi_code=A000058199` `tfda_permit_no=衛署藥製字第000058號` `confidence=0` `status=pending`
  input: DICYCLOMINE HCL 5 MG/GM+ALUMINUM HYDROXIDE (=ALUMINA HYDRATED) 400 MG/GM+MAGNESIUM OXIDE 200 MG/GM
  tfda: MAGNESIUM OXIDE ;; ALUMINUM HYDROXIDE (ALUMINA HYDRATED) ;; DICYCLOMINE HCL
- `nhi_code=A000059100` `tfda_permit_no=衛署藥製字第000059號` `confidence=0` `status=pending`
  input: DIAZEPAM 2 MG
  tfda: DIAZEPAM
- `nhi_code=A0000591G0` `tfda_permit_no=衛署藥製字第000059號` `confidence=0` `status=pending`
  input: DIAZEPAM 2 MG
  tfda: DIAZEPAM
- `nhi_code=A000060100` `tfda_permit_no=衛署藥製字第000060號` `confidence=0` `status=pending`
  input: DIAZEPAM 5 MG
  tfda: DIAZEPAM
- `nhi_code=A0000601G0` `tfda_permit_no=衛署藥製字第000060號` `confidence=0` `status=pending`
  input: DIAZEPAM 5 MG
  tfda: DIAZEPAM
